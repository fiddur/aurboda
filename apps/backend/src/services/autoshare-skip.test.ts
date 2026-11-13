import { describe, expect, test } from 'vitest'

import type { NotificationRecord } from '../db/index.ts'

import { autosharePendingSkipHandler, skipAutoshare, type SkipAutoshareDeps } from './autoshare-skip.ts'

const setup = (over: Partial<SkipAutoshareDeps> = {}) => {
  const log: string[] = []
  const deps: SkipAutoshareDeps = {
    getGroupIds: async () => ['a1', 'a2'],
    insertSuppressions: async (_user, ids) => {
      log.push(`suppress ${ids.join(',')}`)
    },
    postIdsForActivities: async () => {
      log.push('posts')
      return []
    },
    ...over,
  }
  return { log, skip: skipAutoshare(deps) }
}

describe('skipAutoshare', () => {
  test('suppresses the whole merge group', async () => {
    const { log, skip } = setup()
    expect(await skip('alice', 'a1')).toEqual({ activity_ids: ['a1', 'a2'], status: 'skipped' })
    expect(log).toEqual(['suppress a1,a2', 'posts'])
  })

  test('not_found for an activity that does not exist, touching nothing', async () => {
    const { log, skip } = setup({ getGroupIds: async () => [] })
    expect(await skip('alice', 'gone')).toEqual({ status: 'not_found' })
    expect(log).toEqual([])
  })

  test('already_shared when a post references the group, found after suppressing', async () => {
    const { log, skip } = setup({
      postIdsForActivities: async () => {
        log.push('posts')
        return ['post-1']
      },
    })
    expect(await skip('alice', 'a1')).toEqual({ post_id: 'post-1', status: 'already_shared' })
    expect(log).toEqual(['suppress a1,a2', 'posts'])
  })
})

const pending = (data: Record<string, unknown> | null): NotificationRecord => ({
  actions: [{ key: 'skip', label: "Don't share" }],
  body: null,
  created_at: new Date('2026-11-13T12:00:00Z'),
  data,
  dedupe_key: 'autoshare_pending:a1',
  id: '11111111-1111-4111-8111-111111111111',
  in_app: true,
  link: '/detail/activity/a1',
  push: true,
  read_at: null,
  title: 'Your new run will be shared in about 10 minutes',
  type: 'autoshare_pending',
})

describe('autosharePendingSkipHandler', () => {
  const data = { activity_id: 'a1', activity_label: 'run' }

  test('skipped: says it will not be shared', async () => {
    const skipped: string[] = []
    const handler = autosharePendingSkipHandler(async (_user, id) => {
      skipped.push(id)
      return { activity_ids: [id], status: 'skipped' }
    })
    expect(await handler('alice', pending(data))).toEqual({
      ok: true,
      revision: { title: 'Your run will not be shared' },
    })
    expect(skipped).toEqual(['a1'])
  })

  test('an activity deleted meanwhile counts as skipped', async () => {
    const handler = autosharePendingSkipHandler(async () => ({ status: 'not_found' }))
    expect(await handler('alice', pending(data))).toEqual({
      ok: true,
      revision: { title: 'Your run will not be shared' },
    })
  })

  test('already shared: a conflict that revises the notification to link the post', async () => {
    const handler = autosharePendingSkipHandler(async () => ({ post_id: 'p1', status: 'already_shared' }))
    expect(await handler('alice', pending(data))).toEqual({
      message: 'This activity was already shared',
      ok: false,
      revision: { link: '/u/alice/posts/p1', title: 'Your run was shared' },
    })
  })

  test('a notification without an activity is a conflict and skips nothing', async () => {
    let called = false
    const handler = autosharePendingSkipHandler(async () => {
      called = true
      return { status: 'not_found' }
    })
    expect((await handler('alice', pending(null))).ok).toBe(false)
    expect(called).toBe(false)
  })
})
