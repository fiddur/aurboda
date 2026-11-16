import { describe, expect, test } from 'vitest'

import {
  cutLine,
  densify,
  distinctSessions,
  sharedRuns,
  suggestStretches,
  toLocalMetres,
  type Xy,
} from './segment-suggest.ts'

const LAT0 = 59.3
const LON0 = 18.07
const ORIGIN = { lat: LAT0, lon: LON0 }
const M_PER_DEG_LAT = 111_195
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180)

const toLatLon = ([x, y]: Xy) => ({ lat: LAT0 + y / M_PER_DEG_LAT, lon: LON0 + x / M_PER_DEG_LON })
const line = (corners: Xy[]) => corners.map(toLatLon)

/** A 2 km line heading east from the origin, as a simplified track would store it. */
const A = line([
  [0, 0],
  [2000, 0],
])

const near = (x: number, y: number, tolerance = 20) => Math.abs(x - y) <= tolerance

describe('toLocalMetres and densify', () => {
  test('metres along a line, a point at least every 15 m', () => {
    const xy = toLocalMetres(A, ORIGIN)
    expect(near(xy[1]![0], 2000, 2)).toBe(true)
    const dense = densify(xy)
    expect(dense.length).toBe(Math.ceil(xy[1]![0] / 15) + 1)
    expect(dense[0]!.d).toBe(0)
    expect(near(dense.at(-1)!.d, 2000, 2)).toBe(true)
    expect(dense.slice(1).every((p, i) => p.d - dense[i]!.d <= 15)).toBe(true)
  })
})

describe('sharedRuns', () => {
  test('two parallel offset lines are one run', () => {
    const runs = sharedRuns(
      A,
      line([
        [0, 8],
        [2000, 8],
      ]),
    )
    expect(runs).toHaveLength(1)
    expect(near(runs[0]!.from_m, 0)).toBe(true)
    expect(near(runs[0]!.to_m, 2000)).toBe(true)
  })

  test('the same line reversed gives none', () => {
    expect(
      sharedRuns(
        A,
        line([
          [2000, 0],
          [0, 0],
        ]),
      ),
    ).toEqual([])
  })

  test("an out-and-back B gives the leg in A's direction only", () => {
    const runs = sharedRuns(
      A,
      line([
        [1000, 5],
        [2000, 5],
        [0, -5],
      ]),
    )
    expect(runs).toHaveLength(1)
    expect(near(runs[0]!.from_m, 1000)).toBe(true)
    expect(near(runs[0]!.to_m, 2000)).toBe(true)
  })

  /** B follows A, but swings 50 m off it over `span` metres from x = 1000. */
  const withDetour = (span: number) =>
    line([
      [0, 0],
      [1000, 0],
      [1000, 50],
      [1000 + span, 50],
      [1000 + span, 0],
      [2000, 0],
    ])

  test('a 30 m gap is bridged', () => {
    // Points of A within 20 m of the edges on either side are near: a 70 m detour leaves ~30 m that is not.
    const runs = sharedRuns(A, withDetour(70))
    expect(runs).toHaveLength(1)
    expect(near(runs[0]!.from_m, 0)).toBe(true)
    expect(near(runs[0]!.to_m, 2000)).toBe(true)
  })

  test('a 100 m gap splits', () => {
    const runs = sharedRuns(A, withDetour(140))
    expect(runs).toHaveLength(2)
    expect(near(runs[0]!.to_m, 1020)).toBe(true)
    expect(near(runs[1]!.from_m, 1120)).toBe(true)
  })

  test('a 300 m run is dropped', () => {
    expect(
      sharedRuns(
        A,
        line([
          [500, 5],
          [800, 5],
        ]),
      ),
    ).toEqual([])
    expect(
      sharedRuns(
        A,
        line([
          [500, 5],
          [1000, 5],
        ]),
      ),
    ).toHaveLength(1)
  })

  test('stays fast: a 10 km track against 150 candidates', () => {
    const long = line(Array.from({ length: 101 }, (_, i): Xy => [i * 100, (i % 2) * 10]))
    const others = Array.from({ length: 150 }, (_, k) =>
      line(Array.from({ length: 300 }, (_point, i): Xy => [i * 33, 5 + (k % 7)])),
    )
    const started = performance.now()
    for (const b of others) sharedRuns(long, b)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('distinctSessions', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h))
  test('rows overlapping in time count once, the first by start then id kept', () => {
    const kept = distinctSessions([
      { activity_id: 'strava', end_time: at(2), start_time: at(1) },
      { activity_id: 'garmin', end_time: at(2), start_time: at(1) },
      { activity_id: 'later', end_time: at(5), start_time: at(4) },
    ])
    expect(kept.map((c) => c.activity_id)).toEqual(['garmin', 'later'])
  })
})

describe('suggestStretches', () => {
  const iv = (activity_id: string, fromKm: number, toKm: number) => ({
    activity_id,
    from_m: fromKm * 1000,
    to_m: toKm * 1000,
  })

  test('staggered intervals give the long stretch with 2 supporters and the short one with 4', () => {
    const stretches = suggestStretches([iv('x', 0, 5), iv('y', 0, 5.2), iv('z', 1, 2), iv('w', 1, 2)])
    expect(stretches).toEqual([
      { activity_ids: expect.arrayContaining(['x', 'y', 'z', 'w']), from_m: 1000, to_m: 2000 },
      { activity_ids: expect.arrayContaining(['x', 'y']), from_m: 0, to_m: 5000 },
    ])
    expect(stretches[0]!.activity_ids).toHaveLength(4)
    expect(stretches[1]!.activity_ids).toHaveLength(2)
  })

  test('one activity with two laps counts once', () => {
    expect(suggestStretches([iv('x', 1, 2), iv('x', 1, 2.05)])).toEqual([])
    const [stretch] = suggestStretches([iv('x', 1, 2), iv('x', 1, 2.05), iv('y', 1, 2)])
    expect(stretch!.activity_ids.toSorted()).toEqual(['x', 'y'])
  })

  test('too few others or too short gives nothing', () => {
    expect(suggestStretches([iv('x', 0, 1)])).toEqual([])
    expect(suggestStretches([iv('x', 0, 0.3), iv('y', 0, 0.3)])).toEqual([])
  })

  test('max and the ordering: most supporters, then longest', () => {
    const intervals = [
      iv('a', 0, 1),
      iv('b', 0, 1),
      iv('a', 2, 4),
      iv('b', 2, 4),
      iv('a', 5, 5.5),
      iv('b', 5, 5.5),
      iv('c', 5, 5.5),
      iv('a', 7, 7.6),
      iv('b', 7, 7.6),
    ]
    const stretches = suggestStretches(intervals, { max: 3 })
    expect(stretches.map((s) => [s.from_m, s.to_m])).toEqual([
      [5000, 5500],
      [2000, 4000],
      [0, 1000],
    ])
  })

  test('trims to the part covered by most supporters', () => {
    const [stretch] = suggestStretches([iv('a', 0, 1), iv('b', 0.1, 1), iv('c', 0, 0.95)], { coverage: 0.8 })
    expect(stretch).toMatchObject({ from_m: 100, to_m: 950 })
  })
})

describe('cutLine', () => {
  const L = line([
    [0, 0],
    [1000, 0],
    [1000, 1000],
  ])

  test('interpolates both ends and keeps the corners between', () => {
    const cut = toLocalMetres(cutLine(L, 500, 1500), ORIGIN)
    expect(cut).toHaveLength(3)
    expect(near(cut[0]![0], 500, 1) && near(cut[0]![1], 0, 1)).toBe(true)
    expect(near(cut[1]![0], 1000, 1) && near(cut[1]![1], 0, 1)).toBe(true)
    expect(near(cut[2]![0], 1000, 1) && near(cut[2]![1], 500, 1)).toBe(true)
  })

  test('a cut inside one edge has two points', () => {
    const cut = toLocalMetres(cutLine(L, 100, 300), ORIGIN)
    expect(cut).toHaveLength(2)
    expect(near(cut[0]![0], 100, 1)).toBe(true)
    expect(near(cut[1]![0], 300, 1)).toBe(true)
  })
})
