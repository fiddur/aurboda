import { describe, expect, test } from 'vitest'

import { findSegmentPasses, type TimedPoint } from './segment-timing.ts'

const LAT0 = 59.3
const LON0 = 18.07
const M_PER_DEG_LAT = 111_195
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180)

type Xy = [number, number]

const toLatLon = ([x, y]: Xy) => ({ lat: LAT0 + y / M_PER_DEG_LAT, lon: LON0 + x / M_PER_DEG_LON })

/** Positions along straight legs between the corners at `speed` m/s, sampled every `every` s from `t0`. */
const run = (corners: Xy[], { every = 1, speed = 4, t0 = 0 } = {}): TimedPoint[] => {
  const legs = corners.slice(1).map((b, i) => {
    const a = corners[i]!
    return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) }
  })
  const total = legs.reduce((sum, leg) => sum + leg.len, 0)
  const points: TimedPoint[] = []
  for (let t = 0; t * speed <= total; t += every) {
    let along = t * speed
    const leg = legs.find((l) => {
      if (along <= l.len) return true
      along -= l.len
      return false
    })!
    const f = leg.len === 0 ? 0 : along / leg.len
    const xy: Xy = [leg.a[0] + (leg.b[0] - leg.a[0]) * f, leg.a[1] + (leg.b[1] - leg.a[1]) * f]
    points.push({ ...toLatLon(xy), t: t0 + t })
  }
  return points
}

/** A 500 m segment heading east from the origin. */
const SEGMENT = [toLatLon([0, 0]), toLatLon([250, 0]), toLatLon([500, 0])]

describe('findSegmentPasses', () => {
  test('a straight pass at 1 Hz is timed within a second', () => {
    const points = run(
      [
        [-200, 0],
        [700, 0],
      ],
      { speed: 4 },
    )
    const passes = findSegmentPasses(points, SEGMENT)
    expect(passes).toHaveLength(1)
    expect(passes[0]!.start_offset_s).toBeCloseTo(50, 0)
    expect(Math.abs(passes[0]!.elapsed_s - 125)).toBeLessThan(1)
  })

  test('entry and exit between samples are interpolated', () => {
    const points = run(
      [
        [-201, 0],
        [700, 0],
      ],
      { every: 2, speed: 3 },
    )
    const [pass] = findSegmentPasses(points, SEGMENT)
    expect(pass!.start_offset_s).toBeCloseTo(67, 1)
    expect(pass!.elapsed_s).toBeCloseTo(500 / 3, 1)
  })

  test('a reversed pass gives none', () => {
    const points = run([
      [700, 0],
      [-200, 0],
    ])
    expect(findSegmentPasses(points, SEGMENT)).toEqual([])
  })

  test('a pass that leaves the buffer midway gives none', () => {
    const points = run([
      [-200, 0],
      [200, 0],
      [200, 100],
      [300, 100],
      [300, 0],
      [700, 0],
    ])
    expect(findSegmentPasses(points, SEGMENT)).toEqual([])
  })

  test('a track starting or ending mid-segment gives none', () => {
    expect(
      findSegmentPasses(
        run([
          [200, 0],
          [700, 0],
        ]),
        SEGMENT,
      ),
    ).toEqual([])
    expect(
      findSegmentPasses(
        run([
          [-200, 0],
          [300, 0],
        ]),
        SEGMENT,
      ),
    ).toEqual([])
  })

  test('three hill repeats give three passes', () => {
    const repeat: Xy[] = [
      [-50, 0],
      [550, 0],
      [550, 60],
      [-50, 60],
    ]
    const points = run([...repeat, ...repeat, ...repeat, [-50, 0], [0, 0]], { speed: 3 })
    const passes = findSegmentPasses(points, SEGMENT)
    expect(passes).toHaveLength(3)
    for (const pass of passes) expect(Math.abs(pass.elapsed_s - 500 / 3)).toBeLessThan(1)
    expect(passes[1]!.start_offset_s - passes[0]!.start_offset_s).toBeCloseTo(1320 / 3, 0)
  })

  test('a loop crossing the start twice: across it, then along the segment', () => {
    const corners: Xy[] = [
      [-5, -150],
      [5, 150],
      [-150, 150],
      [-150, 0],
      [700, 0],
    ]
    const toStart = Math.hypot(10, 300) + 155 + 150 + 150
    const passes = findSegmentPasses(run(corners), SEGMENT)
    expect(passes).toHaveLength(1)
    expect(passes[0]!.start_offset_s).toBeCloseTo(toStart / 4, 0)
    expect(Math.abs(passes[0]!.elapsed_s - 125)).toBeLessThan(1)
  })

  test('jitter that steps back a few metres is still one pass', () => {
    const points = run([
      [-200, 0],
      [700, 0],
    ]).map((p, i) =>
      i % 7 === 3 ? { ...p, lon: p.lon - 6 / M_PER_DEG_LON, lat: p.lat + 4 / M_PER_DEG_LAT } : p,
    )
    const passes = findSegmentPasses(points, SEGMENT)
    expect(passes).toHaveLength(1)
    expect(Math.abs(passes[0]!.elapsed_s - 125)).toBeLessThan(2)
  })

  test('a sparse 5 s track is still timed', () => {
    const points = run(
      [
        [-200, 0],
        [700, 0],
      ],
      { every: 5, speed: 3.3 },
    )
    const [pass] = findSegmentPasses(points, SEGMENT)
    expect(Math.abs(pass!.elapsed_s - 500 / 3.3)).toBeLessThan(1)
  })

  test('a runner stopping just short of the end still finishes', () => {
    const points = run([
      [-200, 0],
      [495, 0],
      [495, 100],
    ])
    const [pass] = findSegmentPasses(points, SEGMENT)
    expect(pass).toBeDefined()
  })
})
