import { describe, expect, test } from 'vitest'

import type { Activity, AutoshareCandidate, FeedPostRecord } from '../db/index.ts'
import type { FeedRefreshDeps, FeedRefreshWindowDeps } from './feed-refresh.ts'

import { STABILISATION_SECONDS } from './autoshare.ts'
import { refreshChangedSharesInWindow, refreshFeedPostsForActivity } from './feed-refresh.ts'

const T0 = new Date('2026-08-01T08:00:00Z')

const activity = (id: string): Activity => ({
  activity_type: 'running',
  end_time: new Date(T0.getTime() + 3_600_000),
  id,
  source: 'garmin',
  start_time: T0,
})

const post = (id: string, over: Partial<FeedPostRecord> = {}): FeedPostRecord => ({
  activity_id: 'a1',
  article: null,
  autoshare_rule_id: null,
  challenge: null,
  created_at: T0,
  id,
  image_token: 'token',
  in_reply_to_actor_uri: null,
  in_reply_to_handle: null,
  in_reply_to_uri: null,
  include_chart: true,
  include_map: true,
  included_metrics: [],
  kind: 'activity',
  message: null,
  series_metrics: [],
  updated_at: T0,
  visibility: 'followers',
  ...over,
})

const harness = (over: Partial<FeedRefreshDeps> = {}) => {
  const touched: string[] = []
  const delivered: string[] = []
  const queriedIds: string[][] = []
  const deps: FeedRefreshDeps = {
    deliverUpdated: (_user, record) => {
      delivered.push(record.id)
    },
    getActivity: async (_user, id) => activity(id),
    getGroup: async (_user, a) => [a, activity('a2')],
    activityPostIds: async (_user, ids) => {
      queriedIds.push(ids)
      return ['p1', 'p2']
    },
    touchPost: async (_user, id) => {
      touched.push(id)
      return post(id)
    },
    ...over,
  }
  return { delivered, deps, queriedIds, touched }
}

describe('refreshFeedPostsForActivity', () => {
  test('touches and re-delivers every post of the merge group once', async () => {
    const h = harness()
    expect(await refreshFeedPostsForActivity('u', 'a1', h.deps)).toBe(2)
    expect(h.queriedIds).toEqual([['a1', 'a2']])
    expect(h.touched).toEqual(['p1', 'p2'])
    expect(h.delivered).toEqual(['p1', 'p2'])
  })

  test('an activity outside any group is its own group', async () => {
    const h = harness({ getGroup: async () => [] })
    await refreshFeedPostsForActivity('u', 'a1', h.deps)
    expect(h.queriedIds).toEqual([['a1']])
  })

  test('a missing activity refreshes nothing', async () => {
    const h = harness({ getActivity: async () => null })
    expect(await refreshFeedPostsForActivity('u', 'a1', h.deps)).toBe(0)
    expect(h.queriedIds).toEqual([])
  })

  test('a post that vanished before the touch is skipped', async () => {
    const h = harness({ touchPost: async (_user, id) => (id === 'p1' ? null : post(id)) })
    expect(await refreshFeedPostsForActivity('u', 'a1', h.deps)).toBe(1)
    expect(h.delivered).toEqual(['p2'])
  })
})

describe('refreshChangedSharesInWindow', () => {
  const MINUTE = 60_000
  const SETTLE = STABILISATION_SECONDS * 1000
  const windowStart = T0
  const windowEnd = new Date(T0.getTime() + 2 * 3_600_000)
  const sharedAt = new Date(T0.getTime() + 2 * 3_600_000)
  const changedAt = new Date(sharedAt.getTime() + 30 * MINUTE)
  const settled = new Date(changedAt.getTime() + SETTLE)

  const candidate = (id: string): AutoshareCandidate => ({
    activity_type: 'yoga',
    created_at: T0,
    data: null,
    detail_pending: false,
    end_time: new Date(T0.getTime() + 3_600_000),
    id,
    source: 'aurboda',
    start_time: T0,
    superseded_by: null,
    title: null,
  })

  const windowHarness = (
    options: {
      versions?: Record<string, { activityId: string; updatedAt: Date }>
      changed?: Date | null
      groups?: Record<string, string[]>
      listed?: string[]
    } = {},
    over: Partial<FeedRefreshWindowDeps> = {},
  ) => {
    const versions = options.versions ?? {
      p1: { activityId: 'a1', updatedAt: sharedAt },
      p2: { activityId: 'a2', updatedAt: sharedAt },
    }
    const groups = options.groups ?? { a1: ['a1', 'a2'], a2: ['a1', 'a2'] }
    const delivered: string[] = []
    const requeued: Date[] = []
    let clock = settled
    const deps: FeedRefreshWindowDeps = {
      deliverUpdated: (_user, record) => {
        delivered.push(record.id)
      },
      getChangedAt: async () => (options.changed === undefined ? changedAt : options.changed),
      getGroup: async (_user, c) => (groups[c.id] ?? [c.id]).map(candidate),
      listSharedActivities: async () => (options.listed ?? ['a1', 'a2']).map(candidate),
      listPostVersions: async (_user, ids) =>
        Object.entries(versions)
          .filter(([, version]) => ids.includes(version.activityId))
          .map(([id, version]) => ({ id, updated_at: version.updatedAt })),
      requeue: async (_user, _start, _end, notBefore) => {
        requeued.push(notBefore)
      },
      touchPost: async (_user, id) => {
        const version = versions[id]
        if (version == null) return null
        version.updatedAt = clock
        return post(id, { activity_id: version.activityId, updated_at: clock })
      },
      ...over,
    }
    const advance = (to: Date) => {
      clock = to
    }
    return { advance, delivered, deps, requeued }
  }

  test('a changed group refreshes each stale post once and returns the count', async () => {
    const h = windowHarness()
    expect(await refreshChangedSharesInWindow('u', windowStart, windowEnd, h.deps, settled)).toBe(2)
    expect(h.delivered).toEqual(['p1', 'p2'])
    expect(h.requeued).toEqual([])
  })

  test('posts newer than the change are left alone', async () => {
    const h = windowHarness({
      versions: {
        p1: { activityId: 'a1', updatedAt: new Date(changedAt.getTime() + MINUTE) },
        p2: { activityId: 'a2', updatedAt: sharedAt },
      },
    })
    expect(await refreshChangedSharesInWindow('u', windowStart, windowEnd, h.deps, settled)).toBe(1)
    expect(h.delivered).toEqual(['p2'])
  })

  test('an unchanged group delivers nothing', async () => {
    const h = windowHarness({ changed: new Date(sharedAt.getTime() - MINUTE) })
    expect(await refreshChangedSharesInWindow('u', windowStart, windowEnd, h.deps, settled)).toBe(0)
    expect(h.delivered).toEqual([])
  })

  test('a change younger than the settle time re-queues once, for the earliest, and delivers nothing', async () => {
    const later = new Date(changedAt.getTime() + 2 * MINUTE)
    const changes: Record<string, Date> = { a1: changedAt, b1: later }
    const h = windowHarness(
      {
        groups: { a1: ['a1'], b1: ['b1'] },
        listed: ['b1', 'a1'],
        versions: {
          p1: { activityId: 'a1', updatedAt: sharedAt },
          q1: { activityId: 'b1', updatedAt: sharedAt },
        },
      },
      { getChangedAt: async (_user, ids) => changes[ids[0] ?? ''] ?? null },
    )
    const now = new Date(changedAt.getTime() + 5 * MINUTE)
    expect(await refreshChangedSharesInWindow('u', windowStart, windowEnd, h.deps, now)).toBe(0)
    expect(h.delivered).toEqual([])
    expect(h.requeued).toEqual([settled])
  })

  test('a group that was never shared is skipped without looking up its change time', async () => {
    let changeLookups = 0
    const h = windowHarness(
      { versions: {} },
      {
        getChangedAt: async () => {
          changeLookups++
          return changedAt
        },
      },
    )
    expect(await refreshChangedSharesInWindow('u', windowStart, windowEnd, h.deps, settled)).toBe(0)
    expect(changeLookups).toBe(0)
  })

  test('groups are deduped by their anchor', async () => {
    const groupLookups: string[] = []
    const h = windowHarness(
      { versions: { p1: { activityId: 'a1', updatedAt: sharedAt } } },
      {
        listPostVersions: async (_user, ids) => {
          groupLookups.push(ids.join(','))
          return ids.includes('a1') ? [{ id: 'p1', updated_at: sharedAt }] : []
        },
      },
    )
    await refreshChangedSharesInWindow('u', windowStart, windowEnd, h.deps, settled)
    expect(groupLookups).toEqual(['a1,a2'])
  })

  test('a second run after the touch delivers nothing', async () => {
    const h = windowHarness()
    expect(await refreshChangedSharesInWindow('u', windowStart, windowEnd, h.deps, settled)).toBe(2)
    const later = new Date(settled.getTime() + MINUTE)
    h.advance(later)
    expect(await refreshChangedSharesInWindow('u', windowStart, windowEnd, h.deps, later)).toBe(0)
    expect(h.delivered).toEqual(['p1', 'p2'])
  })

  test('a post that vanished before the touch is not delivered', async () => {
    const h = windowHarness({}, { touchPost: async () => null })
    expect(await refreshChangedSharesInWindow('u', windowStart, windowEnd, h.deps, settled)).toBe(0)
    expect(h.delivered).toEqual([])
  })
})
