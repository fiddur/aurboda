import { describe, expect, test, vi } from 'vitest'

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
  type NotificationStore,
  type NotifierDeps,
  notifyAdminsOfSignup,
  notifyAdminsOfUnfinishedSignup,
  type RaiseNotificationInput,
  serializeNotification,
  pingWhenMarkedRead,
  withNotificationPing,
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
  const openRevisions: [string[], NotificationRevisionPatch][] = []
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
    reviseOpen: async (_user, dedupeKeys, patch) => {
      openRevisions.push([dedupeKeys, patch])
      return []
    },
    ...overrides,
  }
  return { deps, errors, inserts, openRevisions, prunes, revisions }
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

describe('createNotifier().reviseOpen', () => {
  test('passes the keys and the patch through', async () => {
    const { deps, openRevisions } = fakeDeps()
    await createNotifier(deps).reviseOpen('alice', ['k1', 'k2'], { actions: [], title: 'Closed' })
    expect(openRevisions).toEqual([[['k1', 'k2'], { actions: [], title: 'Closed' }]])
  })

  test('rejects a link that is not an in-app path', async () => {
    const { deps, openRevisions } = fakeDeps()
    await expect(createNotifier(deps).reviseOpen('alice', ['k'], { link: 'https://x' })).rejects.toThrow()
    expect(openRevisions).toEqual([])
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

describe('createNotifier push queueing', () => {
  const settle = () => new Promise((resolve) => setImmediate(resolve))
  const pushDeps = (overrides: Partial<NotifierDeps> = {}) => {
    const queued: [string, string][] = []
    const fake = fakeDeps({
      enqueuePush: async (user, id) => {
        queued.push([user, id])
      },
      ...overrides,
    })
    return { ...fake, queued }
  }

  test('a stored notification with push on is queued for the browsers', async () => {
    const { deps, queued } = pushDeps()
    const row = await createNotifier(deps).raise('alice', input)
    await settle()
    expect(queued).toEqual([['alice', row!.id]])
  })

  test('one with push off is not queued', async () => {
    const { deps, queued } = pushDeps({ getPreference: async () => ({ in_app: true, push: false }) })
    await createNotifier(deps).raise('alice', input)
    await settle()
    expect(queued).toEqual([])
  })

  test('a deduplicated raise stores nothing and queues nothing', async () => {
    const { deps, queued } = pushDeps({ insert: async () => null })
    await createNotifier(deps).raise('alice', input)
    await settle()
    expect(queued).toEqual([])
  })

  test('the raise neither waits for the queue nor fails with it', async () => {
    const { deps, errors } = fakeDeps({
      enqueuePush: async () => {
        throw new Error('queue down')
      },
    })
    const row = await createNotifier(deps).raise('alice', input)
    expect(row).not.toBeNull()
    await settle()
    expect(errors).toEqual([new Error('queue down')])

    const hanging = fakeDeps({ enqueuePush: () => new Promise<void>(() => {}) })
    await expect(createNotifier(hanging.deps).raise('alice', input)).resolves.not.toBeNull()
  })

  test('without a queue nothing is attempted', async () => {
    const { deps, errors } = fakeDeps()
    await createNotifier(deps).raise('alice', input)
    await settle()
    expect(errors).toEqual([])
  })

  test('a revision of an unread push notification is queued again', async () => {
    const { deps, queued } = pushDeps()
    const row = await createNotifier(deps).revise('alice', 'k', { title: 'Shared' })
    await settle()
    expect(queued).toEqual([['alice', row!.id]])
  })

  test('a revision of a read notification is not queued', async () => {
    const { deps, queued } = pushDeps({
      revise: async () => ({
        ...record({ in_app: true, push: true, title: 'x', type: 'admin_signup' }),
        read_at: NOW,
      }),
    })
    await createNotifier(deps).revise('alice', 'k', { title: 'Shared' })
    await settle()
    expect(queued).toEqual([])
  })

  test('each row revised by reviseOpen is queued', async () => {
    const rows = ['a', 'b'].map((id) => ({
      ...record({ in_app: true, push: true, title: 'x', type: 'autoshare_pending' }),
      id,
    }))
    const { deps, queued } = pushDeps({ reviseOpen: async () => rows })
    await createNotifier(deps).reviseOpen('alice', ['k1', 'k2'], { actions: [] })
    await settle()
    expect(queued).toEqual([
      ['alice', 'a'],
      ['alice', 'b'],
    ])
  })
})

describe('createNotifier live ping', () => {
  const settle = () => new Promise((resolve) => setImmediate(resolve))
  const pingDeps = (overrides: Partial<NotifierDeps> = {}) => {
    const pinged: string[] = []
    const fake = fakeDeps({ ping: (user) => void pinged.push(user), ...overrides })
    return { ...fake, pinged }
  }

  test('a stored notification pings, whatever its push switch', async () => {
    const { deps, pinged } = pingDeps({ getPreference: async () => ({ in_app: true, push: false }) })
    await createNotifier(deps).raise('alice', input)
    await settle()
    expect(pinged).toEqual(['alice'])
  })

  test('a raise that stores nothing does not ping', async () => {
    const off = pingDeps({ getPreference: async () => ({ in_app: false, push: false }) })
    await createNotifier(off.deps).raise('alice', input)
    const deduplicated = pingDeps({ insert: async () => null })
    await createNotifier(deduplicated.deps).raise('alice', input)
    await settle()
    expect(off.pinged).toEqual([])
    expect(deduplicated.pinged).toEqual([])
  })

  test('a revision pings, and one that found no row does not', async () => {
    const found = pingDeps()
    await createNotifier(found.deps).revise('alice', 'k', { title: 'Shared' })
    const missing = pingDeps({ revise: async () => null })
    await createNotifier(missing.deps).revise('alice', 'k', { title: 'Shared' })
    await settle()
    expect(found.pinged).toEqual(['alice'])
    expect(missing.pinged).toEqual([])
  })

  test('reviseOpen pings once when it revised rows and not when it revised none', async () => {
    const row = record({ in_app: true, push: true, title: 'x', type: 'autoshare_pending' })
    const some = pingDeps({ reviseOpen: async () => [row, { ...row, id: 'b' }] })
    await createNotifier(some.deps).reviseOpen('alice', ['k1', 'k2'], { actions: [] })
    const none = pingDeps()
    await createNotifier(none.deps).reviseOpen('alice', ['k1'], { actions: [] })
    await settle()
    expect(some.pinged).toEqual(['alice'])
    expect(none.pinged).toEqual([])
  })

  test('a throwing or rejecting ping neither fails nor delays the raise', async () => {
    const throwing = fakeDeps({
      ping: () => {
        throw new Error('ping threw')
      },
    })
    await expect(createNotifier(throwing.deps).raise('alice', input)).resolves.not.toBeNull()
    const rejecting = fakeDeps({ ping: async () => Promise.reject(new Error('ping rejected')) })
    await expect(createNotifier(rejecting.deps).raise('alice', input)).resolves.not.toBeNull()
    const hanging = fakeDeps({ ping: () => new Promise<void>(() => {}) })
    await expect(createNotifier(hanging.deps).raise('alice', input)).resolves.not.toBeNull()
    await settle()
    expect(throwing.errors).toEqual([new Error('ping threw')])
    expect(rejecting.errors).toEqual([new Error('ping rejected')])
  })
})

describe('withNotificationPing', () => {
  const settle = () => new Promise((resolve) => setImmediate(resolve))
  const row = record({ in_app: true, push: true, title: 'x', type: 'admin_signup' })
  const baseStore = (overrides: Partial<NotificationStore> = {}): NotificationStore => ({
    countUnread: async () => 0,
    get: async () => row,
    list: async () => [],
    listPreferences: async () => [],
    markAllRead: async () => 2,
    markRead: async () => ({ ...row, read_at: NOW }),
    revise: async () => row,
    upsertPreference: async () => ({ in_app: true, push: true, type: 'admin_signup', updated_at: NOW }),
    ...overrides,
  })
  const wrap = (overrides: Partial<NotificationStore> = {}) => {
    const pinged: string[] = []
    const errors: unknown[] = []
    const store = withNotificationPing(
      baseStore(overrides),
      (user) => void pinged.push(user),
      (_message, error) => errors.push(error),
    )
    return { errors, pinged, store }
  }

  test('mark read, mark all read and a revision (a run action) ping', async () => {
    const { pinged, store } = wrap()
    await store.markRead('alice', row.id)
    await store.markAllRead('alice')
    await store.revise('alice', row.id, { actions: [], mark_read: true })
    await settle()
    expect(pinged).toEqual(['alice', 'alice', 'alice'])
  })

  test('a write that changed nothing does not ping', async () => {
    const { pinged, store } = wrap({
      markAllRead: async () => 0,
      markRead: async () => null,
      revise: async () => null,
    })
    await store.markRead('alice', row.id)
    await store.markAllRead('alice')
    await store.revise('alice', row.id, { title: 'y' })
    await settle()
    expect(pinged).toEqual([])
  })

  test('reads do not ping and a failing ping does not fail the write', async () => {
    const pinged: string[] = []
    const errors: unknown[] = []
    const store = withNotificationPing(
      baseStore(),
      async (user) => {
        pinged.push(user)
        throw new Error('ping failed')
      },
      (_message, error) => errors.push(error),
    )
    await store.get('alice', row.id)
    await store.countUnread('alice')
    await expect(store.markAllRead('alice')).resolves.toBe(2)
    await settle()
    expect(pinged).toEqual(['alice'])
    expect(errors).toEqual([new Error('ping failed')])
  })
})

describe('pingWhenMarkedRead', () => {
  const settle = () => new Promise((resolve) => setImmediate(resolve))

  test('pings once the write marked something read, and passes its arguments through', async () => {
    const pinged: string[] = []
    const markRead = vi.fn(async (_user: string, _id: string, _except?: string) => 2)
    const wrapped = pingWhenMarkedRead(markRead, (user) => void pinged.push(user))
    await expect(wrapped('alice', 'r1', 'k1')).resolves.toBe(2)
    await settle()
    expect(markRead).toHaveBeenCalledWith('alice', 'r1', 'k1')
    expect(pinged).toEqual(['alice'])
  })

  test('a write that marked nothing does not ping', async () => {
    const pinged: string[] = []
    const wrapped = pingWhenMarkedRead(
      async (_user: string) => 0,
      (user) => void pinged.push(user),
    )
    await wrapped('alice')
    await settle()
    expect(pinged).toEqual([])
  })

  test('a failing ping is logged and does not fail the write', async () => {
    const errors: unknown[] = []
    const wrapped = pingWhenMarkedRead(
      async (_user: string) => 1,
      async () => {
        throw new Error('ping failed')
      },
      (_message, error) => errors.push(error),
    )
    await expect(wrapped('alice')).resolves.toBe(1)
    await settle()
    expect(errors).toEqual([new Error('ping failed')])
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

  test('lists the groups in order (feed, data sources, reminders, admin), each in registry order', () => {
    expect(listNotificationTypeSettings(true, []).map((setting) => setting.type)).toEqual([
      'feed_follow_request',
      'feed_new_follower',
      'feed_follow_accepted',
      'feed_reply',
      'feed_mention',
      'feed_like',
      'feed_boost',
      'feed_post',
      'challenge_comment',
      'challenge_reply',
      'autoshare_pending',
      'garmin_key_expiring',
      'reminder',
      'check_in_due',
      'important_date',
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
    expect(settings.find((setting) => setting.type === 'garmin_key_expiring')).toMatchObject({
      admin_only: false,
      group: 'data_sources',
      group_label: 'Data sources',
    })
    expect(settings.find((setting) => setting.type === 'reminder')).toMatchObject({
      admin_only: false,
      group: 'reminders',
      group_label: 'Reminders',
    })
    expect(settings.find((setting) => setting.type === 'important_date')).toMatchObject({
      admin_only: false,
      group: 'reminders',
      label: 'Important dates',
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

describe('notifyAdminsOfUnfinishedSignup', () => {
  test('raises its own admin_signup notice for every admin except the account', async () => {
    const raised: [string, RaiseNotificationInput][] = []
    await notifyAdminsOfUnfinishedSignup({
      getAdmins: async () => ['root_admin', 'bob'],
      raiseBestEffort: async (user, notification) => {
        raised.push([user, notification])
      },
    })('bob')

    expect(raised).toEqual([
      [
        'root_admin',
        {
          body: 'Single sign-on sign-up could not link the identity and rolling back failed; the account was kept and has no way to sign in.',
          data: { username: 'bob' },
          dedupe_key: 'admin_signup_unfinished:bob',
          link: '/admin/users/bob',
          title: 'Sign-up of bob needs attention',
          type: 'admin_signup',
        },
      ],
    ])
  })
})
