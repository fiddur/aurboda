import { describe, expect, test } from 'vitest'

import type { AutoshareCandidate, AutoshareRuleRecord, FeedPostRecord } from '../db/index.ts'
import type { AutoshareAnnounceInfo, AutoshareDeps } from './autoshare.ts'

import { pendingAutoshareNotification } from './autoshare-notifications.ts'
import {
  activityMatchesRule,
  announceAutoshareWindow,
  dataFiltersMatch,
  DETAIL_WAIT_SECONDS,
  evaluateAutoshareWindow,
  groupData,
  MAX_POSTS_PER_RUN,
  previewAutoshareRule,
  ruleEndedAfter,
  STABILISATION_SECONDS,
} from './autoshare.ts'
import { createNotifier } from './notifications.ts'

const T0 = new Date('2026-08-01T00:00:00Z')
const HOUR = 3_600_000
const NOW = new Date(T0.getTime() + 3 * HOUR)

const rule = (over: Partial<AutoshareRuleRecord> = {}): AutoshareRuleRecord => ({
  activity_types: ['running'],
  created_at: T0,
  data_filters: [],
  delay_minutes: 10,
  enabled: true,
  enabled_at: T0,
  id: 'rule-1',
  include_chart: false,
  include_map: false,
  include_exercises: false,
  included_metrics: ['duration', 'distance'],
  max_age_hours: 24,
  max_duration_seconds: null,
  message: null,
  min_distance_meters: null,
  min_duration_seconds: 15 * 60,
  name: 'Runs > 15 min',
  series_metrics: [],
  tags: null,
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
  dashboard: null,
  exercise: null,
  created_at: T0,
  id,
  image_token: 'token',
  in_reply_to_actor_uri: null,
  in_reply_to_handle: null,
  in_reply_to_uri: null,
  include_chart: false,
  include_map: false,
  include_exercises: false,
  included_metrics: [],
  kind: 'activity',
  message: null,
  series_metrics: [],
  tags: [],
  updated_at: T0,
  visibility: 'followers',
})

const candidate = (id: string, over: Partial<AutoshareCandidate> = {}): AutoshareCandidate => ({
  activity_type: 'running',
  created_at: new Date(T0.getTime() + HOUR),
  data: null,
  detail_pending: false,
  superseded_by: null,
  end_time: new Date(T0.getTime() + 2 * HOUR),
  id,
  source: 'garmin',
  start_time: new Date(T0.getTime() + HOUR),
  title: null,
  ...over,
})

describe('dataFiltersMatch', () => {
  test('no filters always match', () => {
    expect(dataFiltersMatch([], {})).toBe(true)
  })

  test('exists and not_exists treat null, undefined and blank strings as missing', () => {
    const exists = [{ field: 'session_name', operator: 'exists' as const }]
    const missing = [{ field: 'session_name', operator: 'not_exists' as const }]
    expect(dataFiltersMatch(exists, { session_name: 'Yin yoga' })).toBe(true)
    for (const blank of [{}, { session_name: null }, { session_name: '' }, { session_name: '   ' }]) {
      expect(dataFiltersMatch(exists, blank)).toBe(false)
      expect(dataFiltersMatch(missing, blank)).toBe(true)
    }
    expect(dataFiltersMatch(missing, { session_name: 'Yin yoga' })).toBe(false)
  })

  test('eq compares trimmed strings, case-sensitively', () => {
    const eq = (value: boolean | number | string) => [
      { field: 'session_name', operator: 'eq' as const, value },
    ]
    expect(dataFiltersMatch(eq('Yin yoga'), { session_name: ' Yin yoga ' })).toBe(true)
    expect(dataFiltersMatch(eq(' Yin yoga'), { session_name: 'Yin yoga' })).toBe(true)
    expect(dataFiltersMatch(eq('yin yoga'), { session_name: 'Yin yoga' })).toBe(false)
    expect(dataFiltersMatch(eq('Yin yoga'), {})).toBe(false)
    expect(dataFiltersMatch(eq(''), { session_name: '' })).toBe(false)
  })

  test('eq compares numbers and booleans through their string form', () => {
    expect(dataFiltersMatch([{ field: 'laps', operator: 'eq', value: 3 }], { laps: 3 })).toBe(true)
    expect(dataFiltersMatch([{ field: 'laps', operator: 'eq', value: '3' }], { laps: 3 })).toBe(true)
    expect(dataFiltersMatch([{ field: 'indoor', operator: 'eq', value: true }], { indoor: true })).toBe(true)
    expect(dataFiltersMatch([{ field: 'indoor', operator: 'eq', value: true }], { indoor: false })).toBe(
      false,
    )
  })

  test('neq is the negation of eq, so a missing field is not equal', () => {
    const neq = [{ field: 'session_name', operator: 'neq' as const, value: 'Yin yoga' }]
    expect(dataFiltersMatch(neq, { session_name: 'Vinyasa' })).toBe(true)
    expect(dataFiltersMatch(neq, { session_name: 'Yin yoga' })).toBe(false)
    expect(dataFiltersMatch(neq, {})).toBe(true)
  })

  test('every filter must hold', () => {
    const filters = [
      { field: 'session_name', operator: 'exists' as const },
      { field: 'style', operator: 'eq' as const, value: 'yin' },
    ]
    expect(dataFiltersMatch(filters, { session_name: 'Evening', style: 'yin' })).toBe(true)
    expect(dataFiltersMatch(filters, { session_name: 'Evening', style: 'hatha' })).toBe(false)
    expect(dataFiltersMatch(filters, { style: 'yin' })).toBe(false)
  })
})

describe('groupData', () => {
  test('the anchor wins; a later member fills a key the anchor leaves blank', () => {
    const group = [
      candidate('anchor', { data: { session_name: '  ', style: 'yin' } }),
      candidate('override', { data: { session_name: 'Evening', style: 'hatha' } }),
      candidate('third', { data: { session_name: 'Morning', teacher: 'Ann' } }),
    ]
    expect(groupData(group)).toEqual({ session_name: 'Evening', style: 'yin', teacher: 'Ann' })
  })

  test('a member replaced by another member of the group never outranks it', () => {
    const synced = candidate('synced', {
      data: { session_name: 'Yin yoga', style: 'yin' },
      superseded_by: 'override',
    })
    const override = candidate('override', { data: { session_name: 'Hatha', teacher: 'Ann' } })
    expect(groupData([synced, override])).toEqual({ session_name: 'Hatha', teacher: 'Ann' })
    const cleared = candidate('override', { data: { session_name: '' } })
    expect(groupData([synced, cleared])).toEqual({})
  })

  test('a member replaced by a row outside the group still counts', () => {
    const synced = candidate('synced', { data: { session_name: 'Yin yoga' }, superseded_by: 'elsewhere' })
    expect(groupData([synced])).toEqual({ session_name: 'Yin yoga' })
  })

  test('members without data contribute nothing', () => {
    expect(groupData([candidate('a', { data: null }), candidate('b', { data: { x: 1 } })])).toEqual({ x: 1 })
    expect(groupData([candidate('a')])).toEqual({})
  })
})

describe('activityMatchesRule', () => {
  const subject = {
    activityType: 'running',
    data: {},
    distanceMeters: 5000,
    durationSeconds: 1800,
    source: 'garmin',
  }

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

  test('data filters constrain on the subject data', () => {
    const named = rule({ data_filters: [{ field: 'session_name', operator: 'exists' }] })
    expect(activityMatchesRule(named, subject)).toBe(false)
    expect(activityMatchesRule(named, { ...subject, data: { session_name: 'Tempo' } })).toBe(true)
    expect(
      activityMatchesRule(named, { ...subject, data: { session_name: 'Tempo' }, durationSeconds: 60 }),
    ).toBe(false)
  })
})

const yogaRule = rule({
  activity_types: ['yoga'],
  data_filters: [{ field: 'session_name', operator: 'exists' }],
  min_duration_seconds: null,
})
const yoga = (id: string, over: Partial<AutoshareCandidate> = {}) =>
  candidate(id, { activity_type: 'yoga', ...over })

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
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps, NOW)).toBe(1)
    expect(h.createdPosts).toEqual([{ anchorId: 'a1', ruleId: 'rule-1' }])
    expect(h.delivered).toEqual(['post-a1'])
  })

  test('hard dedupe: any existing post referencing the group blocks it forever', async () => {
    const h = harness({ postIdsForActivities: async () => ['existing-post'] })
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps, NOW)).toBe(0)
    expect(h.createdPosts).toEqual([])
  })

  test('merge-group aware: matches on the ANCHOR and processes each group once', async () => {
    const anchor = candidate('anchor', { start_time: new Date(T0.getTime() + HOUR / 2) })
    const members = [anchor, candidate('a1'), candidate('a2')]
    const h = harness({
      getGroup: async () => members,
      listCandidates: async () => [candidate('a1'), candidate('a2')],
    })
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps, NOW)).toBe(1)
    expect(h.createdPosts).toEqual([{ anchorId: 'anchor', ruleId: 'rule-1' }])
  })

  test('never retroactive: an anchor ingested before the enable is skipped', async () => {
    const h = harness({
      getEnabledRules: async () => [rule({ enabled_at: new Date(T0.getTime() + 2 * HOUR) })],
    })
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps, NOW)).toBe(0)
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
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 12 * HOUR), h.deps, NOW)).toBe(0)
  })

  test('a deleted share never comes back: suppressed activities block the group', async () => {
    const h = harness({ suppressedActivityIds: async () => ['a1'] })
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps, NOW)).toBe(0)
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
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps, NOW)).toBe(
      MAX_POSTS_PER_RUN,
    )
    expect(h.createdPosts).toHaveLength(MAX_POSTS_PER_RUN)
  })

  test('a rule with a null enabled_at never matches (defensive)', async () => {
    const h = harness({ getEnabledRules: async () => [rule({ enabled_at: null })] })
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps, NOW)).toBe(0)
  })

  test('skips open-ended windows and vanished (empty-group) candidates', async () => {
    const open = harness({
      resolveWindow: async (_user, anchor) => ({
        activity_type: anchor.activity_type,
        start_time: anchor.start_time,
      }),
    })
    expect(await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), open.deps, NOW)).toBe(0)

    const vanished = harness({ getGroup: async () => [] })
    expect(
      await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), vanished.deps, NOW),
    ).toBe(0)
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
    await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps, NOW)
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
    await evaluateAutoshareWindow('u', T0, new Date(T0.getTime() + 3 * HOUR), h.deps, NOW)
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
    expect(await evaluateAutoshareWindow('u', T0, T0, h.deps, NOW)).toBe(0)
    expect(listed).toBe(false)
  })
})

describe('ruleEndedAfter', () => {
  test('is the enable time while the max age reaches further back', () => {
    expect(ruleEndedAfter(rule(), new Date(T0.getTime() + 10 * HOUR))).toEqual(T0)
  })

  test('is now minus the max age once the enable is older than that', () => {
    const now = new Date(T0.getTime() + 100 * HOUR)
    expect(ruleEndedAfter(rule(), now)).toEqual(new Date(now.getTime() - 24 * HOUR))
    expect(ruleEndedAfter(rule({ max_age_hours: 48 }), now)).toEqual(new Date(now.getTime() - 48 * HOUR))
  })

  test('is null for a rule that was never enabled', () => {
    expect(ruleEndedAfter(rule({ enabled_at: null }), NOW)).toBeNull()
  })
})

describe('evaluateAutoshareWindow: max age', () => {
  const ended = (hoursAgo: number, now: Date) => {
    const end = new Date(now.getTime() - hoursAgo * HOUR)
    return candidate('a1', {
      created_at: new Date(now.getTime() - HOUR),
      end_time: end,
      start_time: new Date(end.getTime() - HOUR),
    })
  }
  const now = new Date(T0.getTime() + 200 * HOUR)
  const windowStart = new Date(now.getTime() - 48 * HOUR)

  test('with the default 24 h, an activity that ended 23 h ago shares and one that ended 25 h ago does not', async () => {
    const recent = harness({ listCandidates: async () => [ended(23, now)] })
    expect(await evaluateAutoshareWindow('u', windowStart, now, recent.deps, now)).toBe(1)

    const old = harness({ listCandidates: async () => [ended(25, now)] })
    expect(await evaluateAutoshareWindow('u', windowStart, now, old.deps, now)).toBe(0)
    expect(old.createdPosts).toEqual([])
  })

  test('each rule applies its own max age', async () => {
    const h = harness({
      getEnabledRules: async () => [
        rule({ id: 'short', max_age_hours: 6 }),
        rule({ id: 'long', max_age_hours: 48 }),
      ],
      listCandidates: async () => [ended(30, now)],
    })
    expect(await evaluateAutoshareWindow('u', windowStart, now, h.deps, now)).toBe(1)
    expect(h.createdPosts).toEqual([{ anchorId: 'a1', ruleId: 'long' }])

    const tooOld = harness({
      getEnabledRules: async () => [
        rule({ id: 'short', max_age_hours: 6 }),
        rule({ id: 'long', max_age_hours: 48 }),
      ],
      listCandidates: async () => [ended(50, now)],
    })
    expect(await evaluateAutoshareWindow('u', windowStart, now, tooOld.deps, now)).toBe(0)
  })

  test('a rule whose max age is too small does not take the match from one whose max age covers it', async () => {
    const h = harness({
      getEnabledRules: async () => [rule({ id: 'first', max_age_hours: 1 }), rule({ id: 'second' })],
      listCandidates: async () => [ended(3, now)],
    })
    expect(await evaluateAutoshareWindow('u', windowStart, now, h.deps, now)).toBe(1)
    expect(h.createdPosts).toEqual([{ anchorId: 'a1', ruleId: 'second' }])
  })

  test('lists candidates that ended after the earliest per-rule cutoff', async () => {
    const listed: (Date | undefined)[] = []
    const h = harness({
      getEnabledRules: async () => [
        rule({ id: 'day' }),
        rule({ id: 'week', max_age_hours: 168 }),
        rule({ enabled_at: new Date(now.getTime() - 2 * HOUR), id: 'fresh', max_age_hours: 8760 }),
      ],
      listCandidates: async (_user, _start, _end, endedAfter) => {
        listed.push(endedAfter)
        return []
      },
    })
    await evaluateAutoshareWindow('u', windowStart, now, h.deps, now)
    expect(listed).toEqual([new Date(now.getTime() - 168 * HOUR)])
  })

  test('an unsettled group that is still recent re-queues as before', async () => {
    const requeued: Date[] = []
    const young = candidate('a1', {
      created_at: new Date(now.getTime() - 60_000),
      end_time: new Date(now.getTime() - HOUR),
      start_time: new Date(now.getTime() - 2 * HOUR),
    })
    const h = harness({
      listCandidates: async () => [young],
      requeue: async (_user, _start, _end, notBefore) => {
        requeued.push(notBefore)
      },
    })
    expect(await evaluateAutoshareWindow('u', windowStart, now, h.deps, now)).toBe(0)
    expect(requeued).toEqual([new Date(young.created_at.getTime() + STABILISATION_SECONDS * 1000)])
  })
})

describe('evaluateAutoshareWindow: data filters', () => {
  const windowEnd = new Date(T0.getTime() + 3 * HOUR)

  test('matches on the merge group data, so an override member carrying the field counts', async () => {
    const h = harness({
      getEnabledRules: async () => [yogaRule],
      getGroup: async () => [
        yoga('garmin-row', { data: { garmin_activity_id: 1 } }),
        yoga('override', { data: { session_name: 'Yin yoga' } }),
      ],
      listCandidates: async () => [yoga('override')],
    })
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, NOW)).toBe(1)
    expect(h.createdPosts).toEqual([{ anchorId: 'garmin-row', ruleId: 'rule-1' }])
  })

  test('an unnamed session is not shared, and is shared once it is named later', async () => {
    let data: Record<string, unknown> | null = { style: 'yin' }
    const h = harness({
      getEnabledRules: async () => [yogaRule],
      listCandidates: async () => [yoga('a1', { data })],
    })
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, NOW)).toBe(0)
    expect(h.createdPosts).toEqual([])

    data = { session_name: 'Evening flow', style: 'yin' }
    const renamedAt = new Date(T0.getTime() + 5 * HOUR)
    expect(await evaluateAutoshareWindow('u', T0, renamedAt, h.deps, NOW)).toBe(1)
    expect(h.createdPosts).toEqual([{ anchorId: 'a1', ruleId: 'rule-1' }])
  })

  test('naming a session later still respects the dedupe and the enable gates', async () => {
    const named = { session_name: 'Evening flow' }
    const shared = harness({
      getEnabledRules: async () => [yogaRule],
      listCandidates: async () => [yoga('a1', { data: named })],
      postIdsForActivities: async () => ['manual-post'],
    })
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, shared.deps, NOW)).toBe(0)

    const beforeEnable = harness({
      getEnabledRules: async () => [{ ...yogaRule, enabled_at: new Date(T0.getTime() + 2 * HOUR) }],
      listCandidates: async () => [yoga('a1', { data: named })],
    })
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, beforeEnable.deps, NOW)).toBe(0)
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

  test('counts only groups whose combined data passes the filters', async () => {
    const groups: Record<string, AutoshareCandidate[]> = {
      named: [yoga('named', { data: { session_name: 'Yin' } })],
      unnamed: [yoga('unnamed', { data: { session_name: '' } })],
      overridden: [yoga('overridden'), yoga('override', { data: { session_name: 'Hatha' } })],
    }
    const h = harness({
      getGroup: async (_user, c) => groups[c.id] ?? [c],
      listCandidates: async () => [yoga('named'), yoga('unnamed'), yoga('overridden')],
    })
    expect(await previewAutoshareRule('u', yogaRule, h.deps, new Date(T0.getTime() + 3 * HOUR))).toBe(2)
  })
})

describe('evaluateAutoshareWindow: pending-share announces', () => {
  const MINUTE = 60_000
  const windowEnd = new Date(T0.getTime() + 3 * HOUR)
  const ingested = new Date(T0.getTime() + 2 * HOUR)

  interface Announced {
    anchorId: string
    ruleId: string
    info: AutoshareAnnounceInfo
  }

  const withHooks = (over: Partial<AutoshareDeps> = {}) => {
    const announced: Announced[] = []
    const requeued: Date[] = []
    const sharedGroups: { postId: string; ids: string[] }[] = []
    const h = harness({
      announce: async (_user, anchor, matched, info) => {
        announced.push({ anchorId: anchor.id, info, ruleId: matched.id })
        return true
      },
      listCandidates: async () => [candidate('a1', { created_at: ingested })],
      requeue: async (_user, _start, _end, notBefore) => {
        requeued.push(notBefore)
      },
      shared: async (_user, post, group) => {
        sharedGroups.push({ ids: group.map((m) => m.id), postId: post.id })
      },
      ...over,
    })
    return { ...h, announced, requeued, sharedGroups }
  }

  test('an unsettled matching group is announced, re-queued and not shared', async () => {
    const h = withHooks()
    const now = new Date(ingested.getTime() + MINUTE)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, now)).toBe(0)
    const settled = new Date(ingested.getTime() + STABILISATION_SECONDS * 1000)
    expect(h.announced).toEqual([
      { anchorId: 'a1', info: { detail_pending: false, share_at: settled }, ruleId: 'rule-1' },
    ])
    expect(h.requeued).toEqual([settled])
    expect(h.createdPosts).toEqual([])
    expect(h.sharedGroups).toEqual([])
  })

  test('an unsettled group that matches no rule is re-queued and not announced', async () => {
    const h = withHooks({
      listCandidates: async () => [candidate('a1', { activity_type: 'yoga', created_at: ingested })],
    })
    const now = new Date(ingested.getTime() + MINUTE)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, now)).toBe(0)
    expect(h.announced).toEqual([])
    expect(h.requeued).toHaveLength(1)
  })

  test("the rule's wait holds a settled group back and announces it for when the wait ends", async () => {
    const h = withHooks({ getEnabledRules: async () => [rule({ delay_minutes: 30 })] })
    const now = new Date(ingested.getTime() + 15 * MINUTE)
    const readyAt = new Date(ingested.getTime() + 30 * MINUTE)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, now)).toBe(0)
    expect(h.announced).toEqual([
      { anchorId: 'a1', info: { detail_pending: false, share_at: readyAt }, ruleId: 'rule-1' },
    ])
    expect(h.requeued).toEqual([readyAt])
    expect(h.createdPosts).toEqual([])

    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, readyAt)).toBe(1)
  })

  test('an unsettled group under a longer rule wait is announced for the later of the two', async () => {
    const h = withHooks({ getEnabledRules: async () => [rule({ delay_minutes: 60 })] })
    const now = new Date(ingested.getTime() + MINUTE)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, now)).toBe(0)
    expect(h.announced[0]?.info.share_at).toEqual(new Date(ingested.getTime() + 60 * MINUTE))
  })

  test('waiting only on the Garmin detail is announced as detail_pending', async () => {
    const h = withHooks({
      listCandidates: async () => [candidate('a1', { created_at: ingested, detail_pending: true })],
    })
    const now = new Date(ingested.getTime() + 30 * MINUTE)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, now)).toBe(0)
    expect(h.announced[0]?.info.detail_pending).toBe(true)
  })

  test('a group past both waits is shared and `shared` gets the group', async () => {
    const h = withHooks({
      getGroup: async () => [
        candidate('anchor', { created_at: ingested }),
        candidate('a1', { created_at: ingested }),
      ],
    })
    const now = new Date(ingested.getTime() + HOUR)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, now)).toBe(1)
    expect(h.sharedGroups).toEqual([{ ids: ['anchor', 'a1'], postId: 'post-anchor' }])
    expect(h.announced).toEqual([])
  })

  test('caps announces per run', async () => {
    const many = Array.from({ length: MAX_POSTS_PER_RUN + 3 }, (_, i) =>
      candidate(`a${i}`, { created_at: ingested, start_time: new Date(T0.getTime() + HOUR + i * MINUTE) }),
    )
    const h = withHooks({ listCandidates: async () => many })
    await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, new Date(ingested.getTime() + MINUTE))
    expect(h.announced).toHaveLength(MAX_POSTS_PER_RUN)
    expect(h.requeued).toHaveLength(1)
  })

  test('a throwing announce or shared hook never stops the run', async () => {
    const h = withHooks({
      announce: async () => {
        throw new Error('notifier down')
      },
      listCandidates: async () => [
        candidate('young', { created_at: ingested, start_time: new Date(T0.getTime() + HOUR / 2) }),
        candidate('old', { created_at: new Date(ingested.getTime() - HOUR) }),
      ],
      shared: async () => {
        throw new Error('notifier down')
      },
    })
    const now = new Date(ingested.getTime() + MINUTE)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, now)).toBe(1)
    expect(h.createdPosts).toEqual([{ anchorId: 'old', ruleId: 'rule-1' }])
    expect(h.requeued).toHaveLength(1)
  })

  test('a production-style announce whose raise fails keeps the run going', async () => {
    const notifier = createNotifier({
      getPreference: async () => {
        throw new Error('database "u" does not exist')
      },
      insert: async () => null,
      prune: async () => 0,
      revise: async () => null,
    })
    const h = withHooks({
      announce: async (user, anchor, matched, info) =>
        (await notifier.raise(
          user,
          pendingAutoshareNotification({ anchor, rule: matched, ...info, now: NOW }),
        )) != null,
    })
    const now = new Date(ingested.getTime() + MINUTE)
    expect(await evaluateAutoshareWindow('u', T0, windowEnd, h.deps, now)).toBe(0)
    expect(h.requeued).toHaveLength(1)
  })
})

describe('announceAutoshareWindow', () => {
  const MINUTE = 60_000
  const windowEnd = new Date(T0.getTime() + 3 * HOUR)
  const ingested = new Date(T0.getTime() + 2 * HOUR)
  const nextEvaluationAt = new Date(ingested.getTime() + 10 * MINUTE)

  const withAnnounce = (over: Partial<AutoshareDeps> = {}) => {
    const announced: { anchorId: string; info: AutoshareAnnounceInfo }[] = []
    let requeues = 0
    let shared = 0
    let delivered = 0
    const h = harness({
      announce: async (_user, anchor, _rule, info) => {
        announced.push({ anchorId: anchor.id, info })
        return true
      },
      onCreated: () => {
        delivered++
      },
      requeue: async () => {
        requeues++
      },
      shared: async () => {
        shared++
      },
      ...over,
    })
    return { ...h, announced, counts: () => ({ delivered, requeues, shared }) }
  }

  test('announces unsettled and settled matches, and creates nothing, never re-queues', async () => {
    const h = withAnnounce({
      listCandidates: async () => [
        candidate('fresh', { created_at: ingested, start_time: new Date(T0.getTime() + HOUR / 2) }),
        candidate('edited', { created_at: new Date(ingested.getTime() - HOUR) }),
      ],
    })
    const now = new Date(ingested.getTime() + MINUTE / 2)
    expect(await announceAutoshareWindow('u', T0, windowEnd, h.deps, nextEvaluationAt, now)).toBe(2)
    expect(h.announced).toEqual([
      {
        anchorId: 'fresh',
        info: {
          detail_pending: false,
          share_at: new Date(ingested.getTime() + STABILISATION_SECONDS * 1000),
        },
      },
      { anchorId: 'edited', info: { detail_pending: false, share_at: nextEvaluationAt } },
    ])
    expect(h.createdPosts).toEqual([])
    expect(h.counts()).toEqual({ delivered: 0, requeues: 0, shared: 0 })
  })

  test('skips groups already posted or suppressed, and ones matching no rule', async () => {
    const posted = withAnnounce({ postIdsForActivities: async () => ['p'] })
    expect(await announceAutoshareWindow('u', T0, windowEnd, posted.deps, nextEvaluationAt, NOW)).toBe(0)
    const suppressed = withAnnounce({ suppressedActivityIds: async () => ['a1'] })
    expect(await announceAutoshareWindow('u', T0, windowEnd, suppressed.deps, nextEvaluationAt, NOW)).toBe(0)
    const yogaOnly = withAnnounce({ listCandidates: async () => [yoga('y1', { created_at: ingested })] })
    expect(await announceAutoshareWindow('u', T0, windowEnd, yogaOnly.deps, nextEvaluationAt, NOW)).toBe(0)
  })

  test('stops at the announce cap', async () => {
    const many = Array.from({ length: MAX_POSTS_PER_RUN + 3 }, (_, i) =>
      candidate(`a${i}`, { created_at: ingested, start_time: new Date(T0.getTime() + HOUR + i * MINUTE) }),
    )
    const h = withAnnounce({ listCandidates: async () => many })
    const now = new Date(ingested.getTime() + MINUTE / 2)
    expect(await announceAutoshareWindow('u', T0, windowEnd, h.deps, nextEvaluationAt, now)).toBe(
      MAX_POSTS_PER_RUN,
    )
  })

  test('a group announced earlier does not count toward the cap', async () => {
    const many = Array.from({ length: MAX_POSTS_PER_RUN + 3 }, (_, i) =>
      candidate(`a${i}`, { created_at: ingested, start_time: new Date(T0.getTime() + HOUR + i * MINUTE) }),
    )
    const attempted: string[] = []
    const h = withAnnounce({
      announce: async (_user, anchor) => {
        attempted.push(anchor.id)
        return attempted.length > MAX_POSTS_PER_RUN
      },
      listCandidates: async () => many,
    })
    const now = new Date(ingested.getTime() + MINUTE / 2)
    expect(await announceAutoshareWindow('u', T0, windowEnd, h.deps, nextEvaluationAt, now)).toBe(3)
    expect(attempted).toHaveLength(MAX_POSTS_PER_RUN + 3)
  })
})
