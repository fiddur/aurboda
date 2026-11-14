import { describe, expect, test } from 'vitest'

import type { NotificationRecord, NotificationRevisionPatch } from '../db/index.ts'

import {
  type NotificationActionHandler,
  runNotificationAction,
  type RunNotificationActionDeps,
} from './notification-actions.ts'

const ID = '11111111-1111-4111-8111-111111111111'

const row = (over: Partial<NotificationRecord> = {}): NotificationRecord => ({
  actions: [{ key: 'skip', label: "Don't share" }],
  body: 'b',
  created_at: new Date('2026-11-13T12:00:00Z'),
  data: { activity_id: 'a1' },
  dedupe_key: 'autoshare_pending:a1',
  id: ID,
  in_app: true,
  link: '/detail/activity/a1',
  push: true,
  read_at: null,
  title: 'Pending',
  type: 'autoshare_pending',
  ...over,
})

const setup = (handler: NotificationActionHandler, stored: NotificationRecord | null = row()) => {
  const revisions: NotificationRevisionPatch[] = []
  const calls: NotificationRecord[] = []
  const deps: RunNotificationActionDeps = {
    get: async () => stored,
    handlers: {
      autoshare_pending: {
        skip: async (user, notification) => {
          calls.push(notification)
          return handler(user, notification)
        },
      },
    },
    revise: async (_user, _id, patch) => {
      revisions.push(patch)
      return stored && { ...stored, ...patch, read_at: new Date() }
    },
  }
  return { calls, revisions, run: runNotificationAction(deps) }
}

const ok: NotificationActionHandler = async () => ({ ok: true, revision: { title: 'Skipped' } })

describe('runNotificationAction', () => {
  test('ok: applies the revision, clears the actions and marks it read', async () => {
    const { calls, revisions, run } = setup(ok)
    const outcome = await run('alice', ID, 'skip')

    expect(outcome.status).toBe('ok')
    expect(outcome.status === 'ok' && outcome.notification.title).toBe('Skipped')
    expect(calls).toHaveLength(1)
    expect(revisions).toEqual([{ actions: [], mark_read: true, title: 'Skipped' }])
  })

  test('not_found for a non-uuid id or a missing row', async () => {
    expect(await setup(ok).run('alice', 'nope', 'skip')).toEqual({ status: 'not_found' })
    expect(await setup(ok, null).run('alice', ID, 'skip')).toEqual({ status: 'not_found' })
  })

  test('not_found when the row no longer offers the key, so an action cannot run twice', async () => {
    const { calls, run } = setup(ok, row({ actions: [] }))
    expect(await run('alice', ID, 'skip')).toEqual({ status: 'not_found' })
    expect(calls).toEqual([])
  })

  test('not_found when no handler is registered for the type and key', async () => {
    expect(await setup(ok).run('alice', ID, 'other')).toEqual({ status: 'not_found' })
    const otherType = row({ actions: [{ key: 'skip', label: 'x' }], type: 'feed_like' })
    expect(await setup(ok, otherType).run('alice', ID, 'skip')).toEqual({ status: 'not_found' })
    const unknownType = row({ type: 'gone_type' })
    expect(await setup(ok, unknownType).run('alice', ID, 'skip')).toEqual({ status: 'not_found' })
    expect(
      await setup(ok, row({ actions: [{ key: 'toString', label: 'x' }] })).run('alice', ID, 'toString'),
    ).toEqual({
      status: 'not_found',
    })
  })

  test('conflict carries the message; a revision with it is still applied', async () => {
    const withRevision = setup(async () => ({
      message: 'This activity was already shared',
      ok: false,
      revision: { link: '/u/alice/posts/p', title: 'Shared' },
    }))
    expect(await withRevision.run('alice', ID, 'skip')).toEqual({
      message: 'This activity was already shared',
      status: 'conflict',
    })
    expect(withRevision.revisions).toEqual([
      { actions: [], link: '/u/alice/posts/p', mark_read: true, title: 'Shared' },
    ])

    const bare = setup(async () => ({ message: 'No', ok: false }))
    expect(await bare.run('alice', ID, 'skip')).toEqual({ message: 'No', status: 'conflict' })
    expect(bare.revisions).toEqual([])
  })
})
