import { describe, expect, test, vi } from 'vitest'

vi.mock('./audit-log.ts', () => ({ auditError: vi.fn() }))

import type { RouteRecord } from '../db/routes.ts'

import {
  getRouteDetail,
  isNotReversed,
  matchActivityRoute,
  matchUnroutedTracks,
  paceSecondsPerKm,
  routeName,
  type RouteDetailDeps,
  type RouteMatchDeps,
} from './routes.ts'

const forward = Array.from({ length: 24 }, (_, i) => i / 23)
const reversed = [...forward].reverse()

describe('isNotReversed', () => {
  test('a forward run is not reversed', () => {
    expect(isNotReversed(forward)).toBe(true)
  })

  test('a reversed run is', () => {
    expect(isNotReversed(reversed)).toBe(false)
  })

  test('a loop started elsewhere wraps once and is not reversed', () => {
    expect(isNotReversed([...forward.slice(12), ...forward.slice(0, 12)])).toBe(true)
  })

  test('too few samples counts as reversed', () => {
    expect(isNotReversed([0.1, 0.2, 0.3])).toBe(false)
    expect(isNotReversed([])).toBe(false)
  })

  test("an out-and-back's alternating projections are not reversed", () => {
    expect(isNotReversed([0.1, 0.3, 0.2, 0.4, 0.3, 0.5, 0.4, 0.6])).toBe(true)
  })
})

describe('routeName', () => {
  test('names after the nearby place and the length', () => {
    expect(routeName({ name: 'Söderhallarna' }, 8240)).toBe('Söderhallarna · 8.2 km')
    expect(routeName(null, 5000)).toBe('Route · 5.0 km')
  })

  test('truncates a very long place name so the whole fits the column', () => {
    const name = routeName({ name: 'x'.repeat(300) }, 5000)
    expect(name.length).toBeLessThanOrEqual(255)
    expect(name.endsWith(' · 5.0 km')).toBe(true)
  })
})

describe('paceSecondsPerKm', () => {
  test('prefers the mean speed, then elapsed over distance', () => {
    expect(paceSecondsPerKm(4, 1800, 5000)).toBe(250)
    expect(paceSecondsPerKm(0, 1800, 5000)).toBe(360)
    expect(paceSecondsPerKm(undefined, 1800, undefined)).toBeUndefined()
    expect(paceSecondsPerKm(undefined, 0, 5000)).toBeUndefined()
  })
})

const t0 = new Date('2026-06-01T07:00:00Z')
const t1 = new Date('2026-06-08T07:00:00Z')

const fakeDeps = (overrides: Partial<RouteMatchDeps> = {}): RouteMatchDeps => ({
  attachActivityToRoute: vi.fn(async () => undefined),
  createRouteFromTrack: vi.fn(async () => 'new-route'),
  findNearbyDetectedLocation: vi.fn(async () => null),
  findNearbyNamedLocation: vi.fn(async () => null),
  findRouteCandidates: vi.fn(async () => []),
  findUnroutedTrackCandidates: vi.fn(async () => []),
  getTrackedActivity: vi.fn(async (_user: string, id: string) => ({ activity_id: id, start_time: t1 })),
  getTrackSummary: vi.fn(async () => ({ length_m: 8240, start: { lat: 59.3, lon: 18.07 } })),
  isActivityRouted: vi.fn(async () => false),
  listUnroutedTrackedActivities: vi.fn(async () => []),
  routeDirectionFractions: vi.fn(async () => forward),
  trackDirectionFractions: vi.fn(async () => forward),
  ...overrides,
})

describe('matchActivityRoute', () => {
  test('skips an activity that already has a route', async () => {
    const deps = fakeDeps({ isActivityRouted: vi.fn(async () => true) })
    expect(await matchActivityRoute('u', 'a', deps)).toBe('already_routed')
    expect(deps.findRouteCandidates).not.toHaveBeenCalled()
  })

  test('skips an activity without a track', async () => {
    const deps = fakeDeps({ getTrackedActivity: vi.fn(async () => null) })
    expect(await matchActivityRoute('u', 'a', deps)).toBe('no_track')
  })

  test('attaches to the first covering route running the same way', async () => {
    const deps = fakeDeps({
      findRouteCandidates: vi.fn(async () => [
        { coverage_route: 0.99, coverage_track: 0.85, route_id: 'too-short' },
        { coverage_route: 0.95, coverage_track: 0.97, route_id: 'reverse' },
        { coverage_route: 0.92, coverage_track: 0.94, route_id: 'same' },
      ]),
      routeDirectionFractions: vi.fn(async (_u: string, _a: string, routeId: string) =>
        routeId === 'reverse' ? reversed : forward,
      ),
    })

    expect(await matchActivityRoute('u', 'a', deps)).toBe('matched')
    expect(deps.routeDirectionFractions).not.toHaveBeenCalledWith('u', 'a', 'too-short')
    expect(deps.attachActivityToRoute).toHaveBeenCalledExactlyOnceWith('u', 'a', 'same', 0.92)
    expect(deps.findUnroutedTrackCandidates).not.toHaveBeenCalled()
  })

  test('creates a route from the older of a matching pair', async () => {
    const deps = fakeDeps({
      findUnroutedTrackCandidates: vi.fn(async () => [
        { activity_id: 'older', coverage_route: 0.93, coverage_track: 0.96, start_time: t0 },
      ]),
      findNearbyNamedLocation: vi.fn(async () => ({ name: 'Söderhallarna' })),
    })

    expect(await matchActivityRoute('u', 'new', deps)).toBe('created')
    expect(deps.getTrackSummary).toHaveBeenCalledWith('u', 'older')
    expect(deps.createRouteFromTrack).toHaveBeenCalledWith('u', {
      activity_id: 'older',
      name: 'Söderhallarna · 8.2 km',
    })
    expect(deps.attachActivityToRoute).toHaveBeenCalledWith('u', 'older', 'new-route', 1)
    expect(deps.attachActivityToRoute).toHaveBeenCalledWith('u', 'new', 'new-route', 0.93)
  })

  test('the activity itself is canonical when it is the older one', async () => {
    const deps = fakeDeps({
      findUnroutedTrackCandidates: vi.fn(async () => [
        {
          activity_id: 'later',
          coverage_route: 0.95,
          coverage_track: 0.95,
          start_time: new Date('2026-07-01'),
        },
      ]),
    })

    expect(await matchActivityRoute('u', 'a', deps)).toBe('created')
    expect(vi.mocked(deps.createRouteFromTrack).mock.calls[0]![1].activity_id).toBe('a')
    expect(deps.attachActivityToRoute).toHaveBeenCalledWith('u', 'a', 'new-route', 1)
    expect(deps.attachActivityToRoute).toHaveBeenCalledWith('u', 'later', 'new-route', 0.95)
  })

  test('names after a detected location address when no named location is near, else "Route"', async () => {
    const pair = [{ activity_id: 'older', coverage_route: 0.95, coverage_track: 0.95, start_time: t0 }]
    const withAddress = fakeDeps({
      findNearbyDetectedLocation: vi.fn(async () => ({ address: 'Ringvägen 1, Stockholm, Sweden' })),
      findUnroutedTrackCandidates: vi.fn(async () => pair),
    })
    await matchActivityRoute('u', 'a', withAddress)
    expect(vi.mocked(withAddress.createRouteFromTrack).mock.calls[0]![1].name).toBe('Ringvägen 1 · 8.2 km')

    const nothing = fakeDeps({ findUnroutedTrackCandidates: vi.fn(async () => pair) })
    await matchActivityRoute('u', 'a', nothing)
    expect(vi.mocked(nothing.createRouteFromTrack).mock.calls[0]![1].name).toBe('Route · 8.2 km')
  })

  test('a reversed or non-covering pair creates nothing', async () => {
    const deps = fakeDeps({
      findUnroutedTrackCandidates: vi.fn(async () => [
        { activity_id: 'partial', coverage_route: 0.5, coverage_track: 0.95, start_time: t0 },
        { activity_id: 'reverse', coverage_route: 0.95, coverage_track: 0.95, start_time: t0 },
      ]),
      trackDirectionFractions: vi.fn(async () => reversed),
    })

    expect(await matchActivityRoute('u', 'a', deps)).toBe('unmatched')
    expect(deps.trackDirectionFractions).toHaveBeenCalledExactlyOnceWith('u', 'a', 'reverse')
    expect(deps.createRouteFromTrack).not.toHaveBeenCalled()
    expect(deps.attachActivityToRoute).not.toHaveBeenCalled()
  })
})

describe('matchUnroutedTracks', () => {
  test('counts outcomes, oldest first, and keeps going after a failure', async () => {
    const routed = new Set<string>()
    const deps = fakeDeps({
      attachActivityToRoute: vi.fn(async (_u: string, id: string) => {
        routed.add(id)
      }),
      findRouteCandidates: vi.fn(async (_u: string, id: string) =>
        id === 'c' ? [{ coverage_route: 0.95, coverage_track: 0.95, route_id: 'new-route' }] : [],
      ),
      findUnroutedTrackCandidates: vi.fn(async (_u: string, id: string) =>
        id === 'a' ? [{ activity_id: 'b', coverage_route: 0.95, coverage_track: 0.95, start_time: t1 }] : [],
      ),
      getTrackedActivity: vi.fn(async (_u: string, id: string) => {
        if (id === 'd') throw new Error('bad geometry')
        return { activity_id: id, start_time: t0 }
      }),
      isActivityRouted: vi.fn(async (_u: string, id: string) => routed.has(id)),
      listUnroutedTrackedActivities: vi.fn(async () =>
        ['a', 'b', 'c', 'd', 'e'].map((activity_id) => ({ activity_id, start_time: t0 })),
      ),
    })

    expect(await matchUnroutedTracks('u', deps)).toEqual({ created: 1, matched: 1 })
    expect(routed).toEqual(new Set(['a', 'b', 'c']))
  })
})

describe('getRouteDetail', () => {
  const route: RouteRecord = {
    activity_count: 2,
    activity_type: 'running',
    canonical_activity_id: 'a1',
    created_at: t0,
    end: { lat: 59.31, lon: 18.08 },
    id: 'r1',
    last_activity_at: t1,
    length_m: 2000,
    name: 'Route · 2.0 km',
    start: { lat: 59.3, lon: 18.07 },
    updated_at: t0,
  }

  const detailDeps = (overrides: Partial<RouteDetailDeps> = {}): RouteDetailDeps => ({
    getMetricMeansForWindows: vi.fn(async (_u: string, metric: string) =>
      metric === 'heart_rate' ? [151.234, undefined] : [undefined, undefined],
    ),
    getRouteById: vi.fn(async () => route),
    getRouteGeometry: vi.fn(async () => ({ points: [route.start, route.end] })),
    listRouteEfforts: vi.fn(async () => [
      {
        activity_id: 'a2',
        coverage: 0.95,
        data_distance: 2000,
        end_time: new Date(t1.getTime() + 600_000),
        source: 'garmin',
        start_time: t1,
        title: 'Evening run',
      },
      { activity_id: 'a1', coverage: 1, end_time: null, source: 'strava', start_time: t0, title: null },
    ]),
    ...overrides,
  })

  test('returns the route, its line and each run with elapsed, HR and pace', async () => {
    const deps = detailDeps()
    const detail = await getRouteDetail('u', 'r1', deps)

    expect(detail).toEqual({
      activity_count: 2,
      activity_type: 'running',
      canonical_activity_id: 'a1',
      created_at: t0.toISOString(),
      efforts: [
        {
          activity_id: 'a2',
          avg_hr: 151.2,
          coverage: 0.95,
          distance_m: 2000,
          elapsed_s: 600,
          end_time: new Date(t1.getTime() + 600_000).toISOString(),
          pace_s_per_km: 300,
          source: 'garmin',
          start_time: t1.toISOString(),
          title: 'Evening run',
        },
        { activity_id: 'a1', coverage: 1, elapsed_s: 0, source: 'strava', start_time: t0.toISOString() },
      ],
      end: route.end,
      id: 'r1',
      last_activity_at: t1.toISOString(),
      length_m: 2000,
      name: 'Route · 2.0 km',
      points: [route.start, route.end],
      start: route.start,
      updated_at: t0.toISOString(),
    })
    expect(vi.mocked(deps.getMetricMeansForWindows).mock.calls[0]![2]).toEqual([
      { end: new Date(t1.getTime() + 600_000), start: t1 },
      { end: t0, start: t0 },
    ])
  })

  test('uses the mean speed for pace when there is one', async () => {
    const deps = detailDeps({
      getMetricMeansForWindows: vi.fn(async (_u: string, metric: string) =>
        metric === 'speed' ? [3.2, undefined] : [undefined, undefined],
      ),
    })
    const detail = await getRouteDetail('u', 'r1', deps)
    expect(detail!.efforts[0]!.pace_s_per_km).toBe(312.5)
  })

  test('is null for an unknown route', async () => {
    expect(
      await getRouteDetail('u', 'nope', detailDeps({ getRouteById: vi.fn(async () => null) })),
    ).toBeNull()
  })
})
