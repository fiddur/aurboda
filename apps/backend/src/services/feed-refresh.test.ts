import { describe, expect, test } from 'vitest'

import type { Activity, FeedPostRecord } from '../db/index.ts'
import type { FeedRefreshDeps } from './feed-refresh.ts'

import { refreshFeedPostsForActivity } from './feed-refresh.ts'

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
