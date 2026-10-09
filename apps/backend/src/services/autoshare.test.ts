import { describe, expect, test } from 'vitest'

import type { AutoshareCandidate, AutoshareRuleRecord, FeedPostRecord } from '../db/index.ts'
import type { AutoshareDeps } from './autoshare.ts'

import {
  activityMatchesRule,
  DETAIL_WAIT_SECONDS,
  evaluateAutoshareWindow,
  MAX_POSTS_PER_RUN,
  previewAutoshareRule,
  STABILISATION_SECONDS,
} from './autoshare.ts'

const T0 = new Date('2026-08-01T00:00:00Z')
const HOUR = 3_600_000

const rule = (over: Partial<AutoshareRuleRecord> = {}): AutoshareRuleRecord => ({
  activity_types: ['running'],
  created_at: T0,
  enabled: true,
  enabled_at: T0,
  id: 'rule-1',
  include_chart: false,
  include_map: false,
  included_metrics: ['duration', 'distance'],
  max_duration_seconds: null,
  message: null,
  min_distance_meters: null,
  min_duration_seconds: 15 * 60,
  name: 'Runs > 15 min',
  series_metrics: [],
  source: null,
  updated_at: T0,
  visibility: 'followers',
  ...over,
})

const fakePost = (id: string, activityId: string, ruleId: string): FeedPostRecord => ({
  activity_id: activityId,
  article: null,
  autoshare_rule_id: ruleId,
  challenge: null,
  created_at: T0,
  id,
  image_token: 'token',
  in_reply_to_actor_uri: null,
  in_reply_to_handle: null,
  in_reply_to_uri: null,
  include_chart: false,
  include_map: false,
  included_metrics: [],
  kind: 'activity',
  message: null,
  series_metrics: [],
  updated_at: T0,
  visibility: 'followers',
})

const candidate = (id: string, over: Partial<AutoshareCandidate> = {}): AutoshareCandidate => ({
  activity_type: 'running',
  created_at: new Date(T0.getTime() + HOUR),
  detail_pending: false,
  end_time: new Date(T0.getTime() + 2 * HOUR),
  id,
  source: 'garmin',
  start_time: new Date(T0.getTime() + HOUR),
  title: null,
  ...over,
})

describe('activityMatchesRule', () => {
  const subject = { activityType: 'running', distanceMeters: 5000, durationSeconds: 1800, source: 'garmin' }

  test('the canonical rule: runs longer than 15 minutes', () => {
    expect(activityMatchesRule(rule(), subject)).toBe(true)
    expect(activityMatchesRule(rule(), { ...subject, durationSeconds: 600 })).toBe(false)
    expect(activityMatchesRule(rule(), { ...subject, activityType: 'yoga' })).toBe(false)
  })

  test('an empty type set matches any type', () => {
    expect(activityMatchesRule(rule({ activity_types: [] }), { ...subject, activityType: 'yoga' })).toBe(true)
  })

  test('max duration, source, and min distance all constrain', () => {
    expect(activityMatchesRule(rule({ max_duration_seconds: 1200 }), subject)).toBe(false)
    expect(activityMatchesRule(rule({ source: 'strava' }), subject)).toBe(false)
    expect(activityMatchesRule(rule({ min_distance_meters: 10_000 }), subject)).toBe(false)
    expect(activityMatchesRule(rule({ min_distance_meters: 3000 }), subject)).toBe(true)
  })

  test('a distance requirement without recorded distance never matches', () => {
    expect(
      activityMatchesRule(rule({ min_distance_meters: 1 }), { ...subject, distanceMeters: undefined }),
    ).toBe(false)
  })
})

interface Harness {
  deps: AutoshareDeps
  createdPosts: { anchorId: string; ruleId: string }[]
  delivered: string[]
}

const harness = (over: Partial<AutoshareDeps> = {}): Harness => {
  const createdPosts: { anchorId: string; ruleId: string }[] = []
  const delivered: string[] = []
  const deps: AutoshareDeps = {
    createPost: async (_user, anchor, matchedRule) => {
      createdPosts.push({ anchorId: anchor.id, ruleId: matchedRule.id })
      return fakePost(`post-${anchor.id}`, anchor.id, matchedRule.id)
    },
    distanceMeters: async () => 5000,
    getEnabledRules: async () => [rule()],
    getGroup: async (_user, c) => [c],
    listCandidates: async () => [candidate('a1')],
    onCreated: (_user, post) => {
      delivered.push(post.id)
    },
    postIdsForActivities: async () => [],
    suppressedActivityIds: async () => [],
    resolveWindow: async (_user, anchor) => ({
      activity_type: anchor.activity_type,
      end_time: anchor.end_time,
      start_time: anchor.start_time,
    }),
    ...over,
  }
  return { createdPosts, delivered, deps }
}

describe('evaluateAutoshareWindow', () => {
  test('shares a matching settled activity once, with delivery', async () => {
    const h = harness()
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps)).toBe(1)
    expect(h.createdPosts).toEqual([{ anchorId: 'a1', ruleId: 'rule-1' }])
    expect(h.delivered).toEqual(['post-a1'])
  })

  test('hard dedupe: any existing post referencing the group blocks it forever', async () => {
    const h = harness({ postIdsForActivities: async () => ['existing-post'] })
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps)).toBe(0)
    expect(h.createdPosts).toEqual([])
  })

  test('merge-group aware: matches on the ANCHOR and processes each group once', async () => {
    const anchor = candidate('anchor', { start_time: new Date(T0.getTime() + HOUR / 2) })
    const members = [anchor, candidate('a1'), candidate('a2')]
    const h = harness({
      getGroup: async () => members,
      listCandidates: async () => [candidate('a1'), candidate('a2')],
    })
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps)).toBe(1)
    expect(h.createdPosts).toEqual([{ anchorId: 'anchor', ruleId: 'rule-1' }])
  })

  test('never retroactive: an anchor ingested before the enable is skipped', async () => {
    const h = harness({
      getEnabledRules: async () => [rule({ enabled_at: new Date(T0.getTime() + 2 * HOUR) })],
    })
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps)).toBe(0)
  })

  test('never retroactive: freshly INGESTED history whose activity ENDED before the enable is skipped', async () => {
    // First sync of a new source: a months-old workout lands as a fresh row
    // (created_at ≈ now, passing the ingest gate) — the activity-time gate
    // must still keep it off the feed.
    const enable = new Date(T0.getTime() + 10 * HOUR)
    const h = harness({
      getEnabledRules: async () => [rule({ enabled_at: enable })],
      listCandidates: async () => [
        candidate('old-workout', { created_at: new Date(T0.getTime() + 11 * HOUR) }),
      ],
    })
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 12 * HOUR), h.deps)).toBe(0)
  })

  test('a deleted share never comes back: suppressed activities block the group', async () => {
    const h = harness({ suppressedActivityIds: async () => ['a1'] })
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps)).toBe(0)
    expect(h.createdPosts).toEqual([])
  })

  test('caps posts per run so a wide window can never firehose the feed', async () => {
    const enable = new Date(T0.getTime())
    const many = Array.from({ length: MAX_POSTS_PER_RUN + 3 }, (_, i) =>
      candidate(`a${i}`, {
        created_at: new Date(T0.getTime() + HOUR),
        end_time: new Date(T0.getTime() + HOUR + i * 60_000),
        start_time: new Date(T0.getTime() + i * 60_000),
      }),
    )
    const h = harness({
      getEnabledRules: async () => [rule({ enabled_at: enable, min_duration_seconds: null })],
      listCandidates: async () => many,
    })
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps)).toBe(
      MAX_POSTS_PER_RUN,
    )
    expect(h.createdPosts).toHaveLength(MAX_POSTS_PER_RUN)
  })

  test('a rule with a null enabled_at never matches (defensive)', async () => {
    const h = harness({ getEnabledRules: async () => [rule({ enabled_at: null })] })
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps)).toBe(0)
  })

  test('skips open-ended windows and vanished (empty-group) candidates', async () => {
    const open = harness({
      resolveWindow: async (_user, anchor) => ({
        activity_type: anchor.activity_type,
        start_time: anchor.start_time,
      }),
    })
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), open.deps)).toBe(0)

    const vanished = harness({ getGroup: async () => [] })
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), vanished.deps)).toBe(0)
  })

  test('first matching rule wins; distance is only resolved when some rule needs it', async () => {
    let distanceCalls = 0
    const h = harness({
      distanceMeters: async () => {
        distanceCalls++
        return 5000
      },
      getEnabledRules: async () => [rule({ id: 'r-a' }), rule({ id: 'r-b' })],
    })
    await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps)
    expect(h.createdPosts).toEqual([{ anchorId: 'a1', ruleId: 'r-a' }])
    expect(distanceCalls).toBe(0)
  })

  test('lists only candidates that ended after the earliest enable', async () => {
    const listed: (Date | undefined)[] = []
    const h = harness({
      getEnabledRules: async () => [
        rule({ enabled_at: new Date(T0.getTime() + 2 * HOUR), id: 'later' }),
        rule({ enabled_at: T0, id: 'earlier' }),
        rule({ enabled_at: null, id: 'never' }),
      ],
      listCandidates: async (_user, _start, _end, endedAfter) => {
        listed.push(endedAfter)
        return []
      },
    })
    await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps)
    expect(listed).toEqual([T0])
  })

  test('no enabled rules → nothing is even listed', async () => {
    let listed = false
    const h = harness({
      getEnabledRules: async () => [],
      listCandidates: async () => {
        listed = true
        return []
      },
    })
    expect(await evaluateAutoshareWindow('u', T0, T0, h.deps)).toBe(0)
    expect(listed).toBe(false)
  })
})

describe('evaluateAutoshareWindow: settling', () => {
  const MINUTE = 60_000
  const STABILISATION = STABILISATION_SECONDS * 1000
  const windowEnd = new Date(T0.getTime() + 3 * HOUR)
  const ingested = new Date(T0.getTime() + 2 * HOUR)

  interface Requeued {
    start: Date
    end: Date
    notBefore: Date
  }

  const withRequeue = (over: Partial<AutoshareDeps> = {}) => {
    const requeued: Requeued[] = []
    const h = harness({
      requeue: async (_user, start, end, notBefore) => {
        requeued.push({ end, notBefore, start })
      },
      ...over,
    })
    return { ...h, requeued }
  }

  test('a candidate ingested a minute ago waits, re-queued for when it settles, and shares then', async () => {
    const h = withRequeue({ listCandidates: async () => [candidate('a1', { created_at: ingested })] })
    const now = new Date(ingested.getTime() + MINUTE)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, now)).toBe(0)
    expect(h.createdPosts).toEqual([])
    const settled = new Date(ingested.getTime() + STABILISATION)
    expect(h.requeued).toEqual([{ end: windowEnd, notBefore: settled, start: T0 }])

    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, settled)).toBe(1)
    expect(h.createdPosts).toEqual([{ anchorId: 'a1', ruleId: 'rule-1' }])
    expect(h.requeued).toHaveLength(1)
  })

  test('the youngest merge-group member decides when the group settles', async () => {
    const young = new Date(ingested.getTime() + 5 * MINUTE)
    const h = withRequeue({
      getGroup: async () => [
        candidate('anchor', { created_at: ingested }),
        candidate('a1', { created_at: young }),
      ],
    })
    const now = new Date(ingested.getTime() + STABILISATION)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, now)).toBe(0)
    expect(h.requeued.map((r) => r.notBefore)).toEqual([new Date(young.getTime() + STABILISATION)])
  })

  test('a Garmin-backed candidate waits for its detail, up to the cap', async () => {
    const pending = candidate('a1', { created_at: ingested, detail_pending: true })
    const h = withRequeue({ listCandidates: async () => [pending] })
    const now = new Date(ingested.getTime() + 30 * MINUTE)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, now)).toBe(0)
    expect(h.requeued).toEqual([
      { end: windowEnd, notBefore: new Date(now.getTime() + STABILISATION), start: T0 },
    ])

    const late = new Date(ingested.getTime() + 3 * HOUR)
    expect(late.getTime() - ingested.getTime()).toBeGreaterThan(DETAIL_WAIT_SECONDS * 1000)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, late)).toBe(1)
    expect(h.requeued).toHaveLength(1)
  })

  test('an already-shared young group neither shares nor re-queues', async () => {
    const h = withRequeue({
      listCandidates: async () => [candidate('a1', { created_at: ingested, detail_pending: true })],
      postIdsForActivities: async () => ['existing-post'],
    })
    const now = new Date(ingested.getTime() + MINUTE)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, now)).toBe(0)
    expect(h.createdPosts).toEqual([])
    expect(h.requeued).toEqual([])
  })

  test('several deferred groups re-queue the window once, for the earliest of them', async () => {
    const h = withRequeue({
      listCandidates: async () => [
        candidate('a1', { created_at: ingested, start_time: new Date(T0.getTime() + HOUR / 2) }),
        candidate('a2', { created_at: new Date(ingested.getTime() - 4 * MINUTE) }),
      ],
    })
    const now = new Date(ingested.getTime() + MINUTE)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, now)).toBe(0)
    expect(h.requeued).toEqual([
      { end: windowEnd, notBefore: new Date(ingested.getTime() - 4 * MINUTE + STABILISATION), start: T0 },
    ])
  })

  test('a group ingested before every enable neither waits nor re-queues, and skips the dedupe queries', async () => {
    let dedupeQueries = 0
    const h = withRequeue({
      getEnabledRules: async () => [rule({ enabled_at: new Date(ingested.getTime() + MINUTE) })],
      listCandidates: async () => [candidate('a1', { created_at: ingested, detail_pending: true })],
      postIdsForActivities: async () => {
        dedupeQueries++
        return []
      },
    })
    const now = new Date(ingested.getTime() + 2 * MINUTE)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, now)).toBe(0)
    expect(h.requeued).toEqual([])
    expect(dedupeQueries).toBe(0)
  })

  test('without a requeue dep a deferral is just a skip', async () => {
    const h = harness({ listCandidates: async () => [candidate('a1', { created_at: ingested })] })
    const now = new Date(ingested.getTime() + MINUTE)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, now)).toBe(0)
    expect(h.createdPosts).toEqual([])
  })
})

describe('previewAutoshareRule', () => {
  test('counts matching merge groups, ignoring shared status and enabled_at', async () => {
    const h = harness({
      listCandidates: async () => [candidate('a1'), candidate('a2', { activity_type: 'yoga' })],
      // Deliberately claim an existing post — preview must not consult it.
      postIdsForActivities: async () => ['existing'],
    })
    const count = await previewAutoshareRule(
      'u',
      rule({ enabled_at: null }),
      h.deps,
      new Date(T0.getTime() + 3 * HOUR),
    )
    expect(count).toBe(1)
  })

  test('skips other activity types before resolving their group', async () => {
    const grouped: string[] = []
    const h = harness({
      getGroup: async (_user, c) => {
        grouped.push(c.id)
        return [c]
      },
      listCandidates: async (_user, _start, _end, endedAfter) => {
        expect(endedAfter).toBeUndefined()
        return [candidate('a1'), candidate('a2', { activity_type: 'yoga' })]
      },
    })
    expect(await previewAutoshareRule('u', rule(), h.deps, new Date(T0.getTime() + 3 * HOUR))).toBe(1)
    expect(grouped).toEqual(['a1'])
  })
})
