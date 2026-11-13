import { describe, expect, test } from 'vitest'

import type {
  NotificationInsert,
  NotificationRecord,
  NotificationRevisionPatch,
  NotificationTarget,
} from '../db/index.ts'

import {
  canConfigureNotificationType,
  createNotifier,
  listNotificationTypeSettings,
  type NotifierDeps,
  notifyAdminsOfSignup,
  type RaiseNotificationInput,
  serializeNotification,
} from './notifications.ts'

const NOW = new Date('2026-11-13T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

const record = (input: NotificationInsert): NotificationRecord => ({
  actions: input.actions ?? [],
  body: input.body ?? null,
  created_at: NOW,
  data: input.data ?? null,
  dedupe_key: input.dedupe_key ?? null,
  id: '11111111-1111-4111-8111-111111111111',
  in_app: input.in_app,
  link: input.link ?? null,
  push: input.push,
  read_at: null,
  title: input.title,
  type: input.type,
})

const fakeDeps = (overrides: Partial<NotifierDeps> = {}) => {
  const inserts: NotificationInsert[] = []
  const prunes: [Date, Date][] = []
  const errors: unknown[] = []
  const revisions: [NotificationTarget, NotificationRevisionPatch][] = []
  const deps: NotifierDeps = {
    getPreference: async () => null,
    insert: async (_user, input) => {
      inserts.push(input)
      return record(input)
    },
    logError: (_message, error) => errors.push(error),
    now: () => NOW,
    prune: async (_user, readBefore, anyBefore) => {
      prunes.push([readBefore, anyBefore])
      return 0
    },
    revise: async (_user, target, patch) => {
      revisions.push([target, patch])
      return { ...record({ in_app: true, push: true, title: 'x', type: 'admin_signup' }), ...patch }
    },
    ...overrides,
  }
  return { deps, errors, inserts, prunes, revisions }
}

const input: RaiseNotificationInput = { title: 'Hello', type: 'admin_signup' }

describe('createNotifier().raise', () => {
  test('stores with both switches on when the user has no preference', async () => {
    const { deps, inserts } = fakeDeps()
    const row = await createNotifier(deps).raise('alice', { ...input, body: 'b', link: '/x' })

    expect(row?.title).toBe('Hello')
    expect(inserts).toEqual([
      {
        actions: [],
        body: 'b',
        data: null,
        dedupe_key: null,
        in_app: true,
        link: '/x',
        push: true,
        title: 'Hello',
        type: 'admin_signup',
      },
    ])
  })

  test('stores the actions', async () => {
    const { deps, inserts } = fakeDeps()
    await createNotifier(deps).raise('alice', { ...input, actions: [{ key: 'skip', label: 'Skip' }] })
    expect(inserts[0]?.actions).toEqual([{ key: 'skip', label: 'Skip' }])
  })

  test('copies the stored switches onto the row', async () => {
    const { deps, inserts } = fakeDeps({ getPreference: async () => ({ in_app: true, push: false }) })
    await createNotifier(deps).raise('alice', input)
    expect(inserts[0]).toMatchObject({ in_app: true, push: false })
  })

  test('stores nothing when the type is fully off', async () => {
    const { deps, inserts, prunes } = fakeDeps({
      getPreference: async () => ({ in_app: false, push: false }),
    })
    expect(await createNotifier(deps).raise('alice', input)).toBeNull()
    expect(inserts).toEqual([])
    expect(prunes).toEqual([])
  })

  test('prunes after an insert with the retention windows', async () => {
    const { deps, prunes } = fakeDeps()
    await createNotifier(deps).raise('alice', input)
    expect(prunes).toEqual([[new Date(NOW.getTime() - 90 * DAY), new Date(NOW.getTime() - 365 * DAY)]])
  })

  test('does not prune when the dedupe key was already used', async () => {
    const { deps, prunes } = fakeDeps({ insert: async () => null })
    expect(await createNotifier(deps).raise('alice', { ...input, dedupe_key: 'k' })).toBeNull()
    expect(prunes).toEqual([])
  })

  test('rejects an empty title and a link that is not an in-app path', async () => {
    const { deps, inserts } = fakeDeps()
    const notifier = createNotifier(deps)
    await expect(notifier.raise('alice', { ...input, title: '  ' })).rejects.toThrow()
    await expect(notifier.raise('alice', { ...input, link: 'https://evil.example' })).rejects.toThrow()
    await expect(notifier.raise('alice', { ...input, link: '//evil.example/x' })).rejects.toThrow()
    expect(inserts).toEqual([])
  })

  test('propagates a database error', async () => {
    const { deps } = fakeDeps({
      insert: async () => {
        throw new Error('db down')
      },
    })
    await expect(createNotifier(deps).raise('alice', input)).rejects.toThrow('db down')
  })
})

describe('createNotifier().raiseBestEffort', () => {
  test('logs and swallows every error', async () => {
    const { deps, errors } = fakeDeps({
      getPreference: async () => {
        throw new Error('database "alice" does not exist')
      },
    })
    await expect(createNotifier(deps).raiseBestEffort('alice', input)).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
  })
})

describe('createNotifier().revise', () => {
  test('revises the row with the dedupe key', async () => {
    const { deps, revisions } = fakeDeps()
    const row = await createNotifier(deps).revise('alice', 'k', { actions: [], link: '/y', title: 'New' })

    expect(row?.title).toBe('New')
    expect(revisions).toEqual([[{ dedupe_key: 'k' }, { actions: [], link: '/y', title: 'New' }]])
  })

  test('resolves to null when no row has the key', async () => {
    const { deps } = fakeDeps({ revise: async () => null })
    expect(await createNotifier(deps).revise('alice', 'k', { title: 'New' })).toBeNull()
  })

  test('rejects a link that is not an in-app path and an empty title', async () => {
    const { deps, revisions } = fakeDeps()
    const notifier = createNotifier(deps)
    await expect(notifier.revise('alice', 'k', { link: 'https://evil.example' })).rejects.toThrow()
    await expect(notifier.revise('alice', 'k', { link: '//evil.example' })).rejects.toThrow()
    await expect(notifier.revise('alice', 'k', { title: ' ' })).rejects.toThrow()
    await expect(notifier.revise('alice', 'k', { link: null })).resolves.not.toBeNull()
    expect(revisions).toHaveLength(1)
  })
})

describe('createNotifier().reviseBestEffort', () => {
  test('logs and swallows every error', async () => {
    const { deps, errors } = fakeDeps({
      revise: async () => {
        throw new Error('db down')
      },
    })
    const notifier = createNotifier(deps)
    await expect(notifier.reviseBestEffort('alice', 'k', { title: 'x' })).resolves.toBeUndefined()
    await expect(notifier.reviseBestEffort('alice', 'k', { link: 'https://x' })).resolves.toBeUndefined()
    expect(errors).toHaveLength(2)
  })
})

describe('serializeNotification', () => {
  test('includes the actions', () => {
    const row = record({
      actions: [{ key: 'skip', label: 'Skip' }],
      in_app: true,
      push: true,
      title: 't',
      type: 'autoshare_pending',
    })
    expect(serializeNotification(row).actions).toEqual([{ key: 'skip', label: 'Skip' }])
  })

  test('renders dates as ISO strings', () => {
    const row = { ...record({ in_app: true, push: true, title: 't', type: 'admin_signup' }), read_at: NOW }
    expect(serializeNotification(row)).toMatchObject({
      created_at: '2026-11-13T12:00:00.000Z',
      read_at: '2026-11-13T12:00:00.000Z',
    })
    expect(serializeNotification({ ...row, read_at: null }).read_at).toBeNull()
  })
})

describe('listNotificationTypeSettings', () => {
  test('hides admin-only types from non-admins', () => {
    const types = listNotificationTypeSettings(false, []).map((setting) => setting.type)
    expect(types).not.toContain('admin_signup')
    expect(types).toContain('feed_reply')
  })

  test('joins stored switches and defaults the rest to on', () => {
    expect(listNotificationTypeSettings(true, []).find((setting) => setting.type === 'admin_signup')).toEqual(
      expect.objectContaining({ admin_only: true, in_app: true, push: true }),
    )
    const settings = listNotificationTypeSettings(true, [{ in_app: false, push: true, type: 'admin_signup' }])
    expect(settings.find((setting) => setting.type === 'admin_signup')).toEqual(
      expect.objectContaining({ in_app: false, push: true }),
    )
    expect(
      settings.filter((setting) => setting.type !== 'admin_signup').every((s) => s.in_app && s.push),
    ).toBe(true)
  })

  test('lists the feed group before the admin group, each in registry order', () => {
    expect(listNotificationTypeSettings(true, []).map((setting) => setting.type)).toEqual([
      'feed_follow_request',
      'feed_new_follower',
      'feed_follow_accepted',
      'feed_reply',
      'feed_mention',
      'feed_like',
      'feed_boost',
      'feed_post',
      'autoshare_pending',
      'admin_signup',
    ])
  })

  test('names each type’s group', () => {
    const settings = listNotificationTypeSettings(true, [])
    expect(settings.find((setting) => setting.type === 'admin_signup')).toMatchObject({
      group: 'admin',
      group_label: 'Admin',
    })
    expect(settings.find((setting) => setting.type === 'feed_post')).toMatchObject({
      group: 'feed',
      group_label: 'Feed',
    })
  })
})

describe('canConfigureNotificationType', () => {
  test('is false for an unknown type and for an admin-only type for a non-admin', () => {
    expect(canConfigureNotificationType('nope', true)).toBe(false)
    expect(canConfigureNotificationType('admin_signup', false)).toBe(false)
    expect(canConfigureNotificationType('admin_signup', true)).toBe(true)
  })
})

describe('notifyAdminsOfSignup', () => {
  test('raises admin_signup for every admin except the new account', async () => {
    const raised: [string, RaiseNotificationInput][] = []
    await notifyAdminsOfSignup({
      getAdmins: async () => ['root_admin', 'bob', 'carol'],
      raiseBestEffort: async (user, notification) => {
        raised.push([user, notification])
      },
    })('bob')

    expect(raised.map(([user]) => user)).toEqual(['root_admin', 'carol'])
    expect(raised[0]![1]).toEqual({
      body: 'bob created an account.',
      data: { username: 'bob' },
      dedupe_key: 'admin_signup:bob',
      link: '/admin/users/bob',
      title: 'New signup: bob',
      type: 'admin_signup',
    })
  })

  test('notifies nobody when the new account is the only admin', async () => {
    const raised: string[] = []
    await notifyAdminsOfSignup({
      getAdmins: async () => ['first'],
      raiseBestEffort: async (user) => {
        raised.push(user)
      },
    })('first')
    expect(raised).toEqual([])
  })

  test('never throws when the admin list cannot be read', async () => {
    const errors: unknown[] = []
    await expect(
      notifyAdminsOfSignup({
        getAdmins: async () => {
          throw new Error('central db down')
        },
        logError: (_message, error) => errors.push(error),
        raiseBestEffort: async () => {},
      })('bob'),
    ).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
  })
})
