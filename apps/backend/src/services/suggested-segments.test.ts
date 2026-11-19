import { describe, expect, test, vi } from 'vitest'

import type { SegmentLine } from '../db/segments.ts'
import type { SuggestedSegmentRecord, SuggestionCandidate } from '../db/suggested-segments.ts'
import type { SegmentDeps } from './segments.ts'

import {
  dismissSuggestedSegment,
  listSuggestedSegmentsWithNames,
  promoteSuggestedSegment,
  scanSuggestedSegments,
  type SuggestedSegmentDeps,
  suggestSegmentsForActivity,
} from './suggested-segments.ts'

vi.mock('./audit-log.ts', () => ({ auditError: vi.fn(), auditInfo: vi.fn(), auditWarn: vi.fn() }))

const LAT0 = 59.3
const LON0 = 18.07
const M_PER_DEG_LAT = 111_195
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180)
const xy = (x: number, y = 0) => ({ lat: LAT0 + y / M_PER_DEG_LAT, lon: LON0 + x / M_PER_DEG_LON })

const hour = (h: number) => new Date(Date.UTC(2026, 5, 1, h))

const candidate = (id: string, h: number, points = [xy(-500, 5), xy(1500, 5)]): SuggestionCandidate => ({
  activity_id: id,
  end_time: hour(h + 1),
  points,
  start_time: hour(h),
})

const START = new Date('2026-06-01T07:00:00Z')

const suggestion = (overrides: Partial<SuggestedSegmentRecord> = {}): SuggestedSegmentRecord => ({
  activity_count: 3,
  activity_type: 'running',
  created_at: START,
  id: 'sug1',
  length_m: 1000,
  points: [xy(0), xy(1000)],
  segment_id: null,
  source_activity_id: 'a1',
  status: 'pending',
  ...overrides,
})

const segmentLine = (overrides: Partial<SegmentLine> = {}): SegmentLine => ({
  activity_type: 'running',
  end: xy(1000),
  length_m: 1000,
  start: xy(0),
  wkt: 'LINESTRING(18.07 59.3, 18.087 59.3)',
  ...overrides,
})

const segmentDeps = (): SegmentDeps => ({
  findNearbyNamedLocation: vi.fn(async () => null),
  findSegmentCandidatesForActivity: vi.fn(async () => []),
  findTrackCandidatesForSegment: vi.fn(async () => []),
  getMetricMeansForWindows: vi.fn(async () => []),
  getSegmentById: vi.fn(async () => ({
    activity_type: 'running',
    best_elapsed_s: null,
    created_at: START,
    created_from_activity_id: 'a1',
    created_from_activity_title: null,
    created_from_route_id: null,
    created_from_route_name: null,
    effort_count: 0,
    id: 'seg1',
    last_effort_at: null,
    length_m: 1000,
    name: 'Segment · 1.0 km',
    updated_at: START,
  })),
  getSegmentLine: vi.fn(async () => ({ length_m: 1000, points: [xy(0), xy(1000)] })),
  getTimingTrack: vi.fn(async () => null),
  insertSegment: vi.fn(async () => 'seg1'),
  listSegmentEfforts: vi.fn(async () => []),
  replaceSegmentEfforts: vi.fn(async () => undefined),
  segmentLineFromActivity: vi.fn(),
  segmentLineFromRoute: vi.fn(),
})

const makeDeps = (overrides: Partial<SuggestedSegmentDeps> = {}): SuggestedSegmentDeps => ({
  claimSuggestedSegment: vi.fn(async () => suggestion({ status: 'promoted' })),
  countUnscannedTrackedActivities: vi.fn(async () => 0),
  decideSuggestedSegment: vi.fn(async () => true),
  deleteSegment: vi.fn(async () => true),
  findNearbyNamedLocation: vi.fn(async () => null),
  getSuggestionInput: vi.fn(async () => ({
    activity_type: 'running',
    candidates: [candidate('b', 1), candidate('c', 3), candidate('c-strava', 3)],
    points: [xy(0), xy(1000), xy(1000, 1000)],
  })),
  listSuggestedSegments: vi.fn(async () => [suggestion()]),
  listUnscannedTrackedActivities: vi.fn(async () => []),
  markSuggestionsScanned: vi.fn(async () => undefined),
  now: () => 0,
  releaseStaleSuggestedSegmentClaims: vi.fn(async () => undefined),
  segment: segmentDeps(),
  settleSuggestedSegmentClaim: vi.fn(async () => undefined),
  suggestedSegmentLine: vi.fn(async () => ({ line: segmentLine(), ok: true as const })),
  upsertSuggestion: vi.fn(async () => 'inserted' as const),
  ...overrides,
})

describe('suggestSegmentsForActivity', () => {
  test('a stretch two other sessions share is stored with the count including this activity', async () => {
    const deps = makeDeps({
      getSuggestionInput: vi.fn(async () => ({
        activity_type: 'running',
        candidates: [candidate('b', 1), candidate('c', 3), candidate('d', 5)],
        points: [xy(0), xy(1000), xy(1000, 1000)],
      })),
    })
    expect(await suggestSegmentsForActivity('u', 'a1', deps)).toEqual({ suggested: 1 })
    expect(deps.upsertSuggestion).toHaveBeenCalledTimes(1)
    const input = vi.mocked(deps.upsertSuggestion).mock.calls[0]![1]
    expect(input).toMatchObject({ activity_count: 4, activity_type: 'running', source_activity_id: 'a1' })
    expect(input.wkt).toMatch(/^LINESTRING\(/)
    expect(deps.markSuggestionsScanned).toHaveBeenCalledWith('u', 'a1')
  })

  test('the other source of one session counts once, so one other session is not enough', async () => {
    const deps = makeDeps({
      getSuggestionInput: vi.fn(async () => ({
        activity_type: 'running',
        candidates: [candidate('b', 1), candidate('b-strava', 1)],
        points: [xy(0), xy(1000)],
      })),
    })
    expect(await suggestSegmentsForActivity('u', 'a1', deps)).toEqual({ suggested: 0 })
    expect(deps.upsertSuggestion).not.toHaveBeenCalled()
    expect(deps.markSuggestionsScanned).toHaveBeenCalledWith('u', 'a1')
  })

  test('a stretch whose ends are under 50 m apart is dropped', async () => {
    const loop = [xy(0), xy(300), xy(300, 300), xy(0, 300), xy(0, 20)]
    const deps = makeDeps({
      getSuggestionInput: vi.fn(async () => ({
        activity_type: 'running',
        candidates: [candidate('b', 1, loop), candidate('c', 3, loop)],
        points: loop,
      })),
    })
    expect(await suggestSegmentsForActivity('u', 'a1', deps)).toEqual({ suggested: 0 })
    expect(deps.upsertSuggestion).not.toHaveBeenCalled()
  })

  test('a known stretch counts as nothing new; a deleted activity is only marked', async () => {
    const deps = makeDeps({ upsertSuggestion: vi.fn(async () => 'skipped' as const) })
    expect(await suggestSegmentsForActivity('u', 'a1', deps)).toEqual({ suggested: 0 })
    const gone = makeDeps({ getSuggestionInput: vi.fn(async () => null) })
    expect(await suggestSegmentsForActivity('u', 'a1', gone)).toEqual({ suggested: 0 })
    expect(gone.markSuggestionsScanned).toHaveBeenCalledWith('u', 'a1')
  })
})

describe('scanSuggestedSegments', () => {
  test('runs over the unscanned activities until none are left', async () => {
    let pending = ['a1', 'a2']
    const deps = makeDeps({
      countUnscannedTrackedActivities: vi.fn(async () => pending.length),
      listUnscannedTrackedActivities: vi.fn(async () => pending.map((activity_id) => ({ activity_id }))),
      markSuggestionsScanned: vi.fn(async (_u: string, id: string) => {
        pending = pending.filter((p) => p !== id)
      }),
    })
    expect(await scanSuggestedSegments('u', deps)).toEqual({ remaining: 0, scanned: 2, suggested: 2 })
  })

  test('stops when the time budget is used', async () => {
    let clock = 0
    const deps = makeDeps({
      countUnscannedTrackedActivities: vi.fn(async () => 2),
      getSuggestionInput: vi.fn(async () => {
        clock += 15_000
        return null
      }),
      listUnscannedTrackedActivities: vi.fn(async () => [{ activity_id: 'a1' }, { activity_id: 'a2' }]),
      now: () => clock,
    })
    expect(await scanSuggestedSegments('u', deps, { budgetMs: 10_000 })).toEqual({
      remaining: 2,
      scanned: 1,
      suggested: 0,
    })
  })

  test('a failure on one activity is audited, the activity still marked, the run goes on', async () => {
    let pending = ['bad', 'good']
    const markSuggestionsScanned = vi.fn(async (_u: string, id: string) => {
      pending = pending.filter((p) => p !== id)
    })
    const deps = makeDeps({
      countUnscannedTrackedActivities: vi.fn(async () => pending.length),
      getSuggestionInput: vi.fn(async (_u: string, id: string) => {
        if (id === 'bad') throw new Error('boom')
        return null
      }),
      listUnscannedTrackedActivities: vi.fn(async () => pending.map((activity_id) => ({ activity_id }))),
      markSuggestionsScanned,
    })
    expect(await scanSuggestedSegments('u', deps)).toEqual({ remaining: 0, scanned: 2, suggested: 0 })
    expect(markSuggestionsScanned).toHaveBeenCalledWith('u', 'bad')
  })

  test('an activity whose mark fails is not retried forever', async () => {
    const deps = makeDeps({
      countUnscannedTrackedActivities: vi.fn(async () => 1),
      getSuggestionInput: vi.fn(async () => null),
      listUnscannedTrackedActivities: vi.fn(async () => [{ activity_id: 'stuck' }]),
      markSuggestionsScanned: vi.fn(async () => {
        throw new Error('read-only')
      }),
    })
    expect(await scanSuggestedSegments('u', deps)).toEqual({ remaining: 1, scanned: 1, suggested: 0 })
  })
})

describe('listSuggestedSegmentsWithNames', () => {
  test('serialized, with the named location near the start', async () => {
    const deps = makeDeps({ findNearbyNamedLocation: vi.fn(async () => ({ name: 'Hill' })) })
    expect(await listSuggestedSegmentsWithNames('u', deps)).toEqual([
      {
        activity_count: 3,
        activity_type: 'running',
        created_at: START.toISOString(),
        id: 'sug1',
        length_m: 1000,
        near_name: 'Hill',
        points: [xy(0), xy(1000)],
        source_activity_id: 'a1',
      },
    ])
    expect(deps.releaseStaleSuggestedSegmentClaims).toHaveBeenCalledWith('u')
  })
})

describe('promoteSuggestedSegment', () => {
  test('claims the suggestion, creates the segment from the (trimmed) line and links it', async () => {
    const deps = makeDeps()
    const result = await promoteSuggestedSegment(
      'u',
      'sug1',
      { end_km: 0.8, name: 'Hill', start_km: 0.2 },
      deps,
    )
    expect(result?.ok).toBe(true)
    expect(deps.suggestedSegmentLine).toHaveBeenCalledWith('u', 'sug1', 0.2, 0.8)
    expect(deps.segment.insertSegment).toHaveBeenCalledWith('u', {
      activity_type: 'running',
      created_from_activity_id: 'a1',
      name: 'Hill',
      wkt: segmentLine().wkt,
    })
    expect(deps.claimSuggestedSegment).toHaveBeenCalledWith('u', 'sug1')
    expect(deps.settleSuggestedSegmentClaim).toHaveBeenCalledWith('u', 'sug1', 'seg1')
  })

  test('not found, and nothing created, when the suggestion is not pending (or another promote claimed it)', async () => {
    const taken = makeDeps({ claimSuggestedSegment: vi.fn(async () => null) })
    expect(await promoteSuggestedSegment('u', 'sug1', {}, taken)).toBeNull()
    expect(taken.suggestedSegmentLine).not.toHaveBeenCalled()
    expect(taken.segment.insertSegment).not.toHaveBeenCalled()
    expect(taken.settleSuggestedSegmentClaim).not.toHaveBeenCalled()
  })

  test('a failure while creating gives the claim back and rethrows', async () => {
    const deps = makeDeps({ suggestedSegmentLine: vi.fn(async () => Promise.reject(new Error('db down'))) })
    await expect(promoteSuggestedSegment('u', 'sug1', {}, deps)).rejects.toThrow('db down')
    expect(deps.settleSuggestedSegmentClaim).toHaveBeenCalledWith('u', 'sug1', null)
  })

  test('a failure while linking the segment gives the claim back and rethrows', async () => {
    const settle = vi.fn(async (_u: string, _id: string, segmentId: string | null) => {
      if (segmentId) throw new Error('db down')
    })
    const deps = makeDeps({ settleSuggestedSegmentClaim: settle })
    await expect(promoteSuggestedSegment('u', 'sug1', {}, deps)).rejects.toThrow('db down')
    expect(settle.mock.calls.map((c) => c[2])).toEqual(['seg1', null])
  })

  test('a failure while linking deletes the created segment before giving the claim back', async () => {
    const settle = vi.fn(async (_u: string, _id: string, segmentId: string | null) => {
      if (segmentId) throw new Error('db down')
    })
    const deps = makeDeps({ settleSuggestedSegmentClaim: settle })
    await expect(promoteSuggestedSegment('u', 'sug1', {}, deps)).rejects.toThrow('db down')
    expect(deps.deleteSegment).toHaveBeenCalledWith('u', 'seg1')
    expect(vi.mocked(deps.deleteSegment).mock.invocationCallOrder[0]).toBeLessThan(
      settle.mock.invocationCallOrder[1]!,
    )
  })

  test('a failed delete after a failed link still releases the claim and throws the link error', async () => {
    const settle = vi.fn(async (_u: string, _id: string, segmentId: string | null) => {
      if (segmentId) throw new Error('link failed')
    })
    const deps = makeDeps({
      deleteSegment: vi.fn(async () => Promise.reject(new Error('delete failed'))),
      settleSuggestedSegmentClaim: settle,
    })
    await expect(promoteSuggestedSegment('u', 'sug1', {}, deps)).rejects.toThrow('link failed')
    expect(settle.mock.calls.map((c) => c[2])).toEqual(['seg1', null])
  })

  test('a failed release after a refusal deletes nothing', async () => {
    const deps = makeDeps({
      settleSuggestedSegmentClaim: vi.fn(async () => Promise.reject(new Error('db down'))),
      suggestedSegmentLine: vi.fn(async () => ({ line: segmentLine({ length_m: 80 }), ok: true as const })),
    })
    await expect(promoteSuggestedSegment('u', 'sug1', {}, deps)).rejects.toThrow('db down')
    expect(deps.deleteSegment).not.toHaveBeenCalled()
  })

  test('stale claims are released before claiming', async () => {
    const deps = makeDeps()
    await promoteSuggestedSegment('u', 'sug1', {}, deps)
    expect(vi.mocked(deps.releaseStaleSuggestedSegmentClaims).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.claimSuggestedSegment).mock.invocationCallOrder[0]!,
    )
  })

  test('refusals carry the sentence and make the suggestion pending again', async () => {
    const outside = makeDeps({
      suggestedSegmentLine: vi.fn(async () => ({ ok: false as const, reason: 'out_of_range' as const })),
    })
    expect(await promoteSuggestedSegment('u', 'sug1', { end_km: 9, start_km: 8 }, outside)).toEqual({
      error: 'start_km and end_km must lie within the suggested segment',
      ok: false,
    })
    const short = makeDeps({
      suggestedSegmentLine: vi.fn(async () => ({ line: segmentLine({ length_m: 80 }), ok: true as const })),
    })
    expect(await promoteSuggestedSegment('u', 'sug1', {}, short)).toMatchObject({ ok: false })
    expect(short.settleSuggestedSegmentClaim).toHaveBeenCalledWith('u', 'sug1', null)
    expect(outside.settleSuggestedSegmentClaim).toHaveBeenCalledWith('u', 'sug1', null)
  })

  test('a near-closed line is refused', async () => {
    const closed = makeDeps({
      suggestedSegmentLine: vi.fn(async () => ({ line: segmentLine({ end: xy(0, 30) }), ok: true as const })),
    })
    expect(await promoteSuggestedSegment('u', 'sug1', {}, closed)).toEqual({
      error: "A segment's start and end must be at least 50 m apart: a closed loop cannot be timed.",
      ok: false,
    })
  })
})

describe('dismissSuggestedSegment', () => {
  test('passes the decision through', async () => {
    const deps = makeDeps({ decideSuggestedSegment: vi.fn(async () => false) })
    expect(await dismissSuggestedSegment('u', 'sug1', deps)).toBe(false)
    expect(deps.decideSuggestedSegment).toHaveBeenCalledWith('u', 'sug1', 'dismissed')
  })
})
