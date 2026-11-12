import { describe, expect, test } from 'vitest'

import {
  activityInterval,
  type BinnedSeries,
  binSeries,
  bucketsPerSide,
  clampWindowMinutes,
  mergeIntoSessions,
  type MetricSeries,
  pairedEffect,
  summarizeImpact,
  timelineBuckets,
  valuesBetween,
  windowStats,
} from './impact.ts'

const T0 = Date.parse('2026-03-02T12:00:00Z')
const min = (m: number) => T0 + m * 60_000
const at = (m: number) => new Date(min(m))
const empty: BinnedSeries = { times: [], values: [] }
const only = (stress: BinnedSeries): MetricSeries => ({ hr: empty, hrv: empty, stress })
const bins = (points: [number, number][]): BinnedSeries =>
  binSeries(points.map(([m, v]) => [at(m), v] as [Date, number]))

describe('clampWindowMinutes', () => {
  test('defaults, clamps and rejects NaN', () => {
    expect(clampWindowMinutes(undefined)).toBe(30)
    expect(clampWindowMinutes(Number.NaN)).toBe(30)
    expect(clampWindowMinutes(1)).toBe(10)
    expect(clampWindowMinutes(5000)).toBe(1440)
    expect(clampWindowMinutes(45)).toBe(45)
  })
})

describe('binSeries', () => {
  test('a dense bin and a sparse bin weigh the same', () => {
    const dense: [Date, number][] = Array.from({ length: 300 }, (_, i) => [new Date(min(0) + i * 1000), 100])
    const series = binSeries([...dense, [at(7), 50]])

    expect(series.times).toEqual([min(0), min(5)])
    expect(series.values).toEqual([100, 50])
  })

  test('bins are aligned to the epoch and sorted', () => {
    const series = binSeries([
      [at(12), 3],
      [at(1), 1],
      [at(3), 2],
    ])
    expect(series.times).toEqual([min(0), min(10)])
    expect(series.values).toEqual([1.5, 3])
  })
})

describe('valuesBetween', () => {
  test('is half-open and empty for inverted ranges', () => {
    const series = bins([
      [0, 1],
      [5, 2],
      [10, 3],
    ])
    expect(valuesBetween(series, min(0), min(10))).toEqual([1, 2])
    expect(valuesBetween(series, min(10), min(5))).toEqual([])
  })
})

describe('mergeIntoSessions', () => {
  test('overlapping intervals (the same session from two sources) become one', () => {
    expect(
      mergeIntoSessions([
        { end: min(60), start: min(0) },
        { end: min(61), start: min(1) },
      ]),
    ).toEqual([{ end: min(61), start: min(0) }])
  })

  test('a gap of at most 10 minutes merges, a longer one does not', () => {
    expect(
      mergeIntoSessions([
        { end: min(30), start: min(0) },
        { end: min(60), start: min(40) },
      ]),
    ).toEqual([{ end: min(60), start: min(0) }])
    expect(
      mergeIntoSessions([
        { end: min(30), start: min(0) },
        { end: min(60), start: min(41) },
      ]),
    ).toHaveLength(2)
  })

  test('sorts unsorted input', () => {
    expect(
      mergeIntoSessions([
        { end: min(130), start: min(100) },
        { end: min(30), start: min(0) },
      ]),
    ).toEqual([
      { end: min(30), start: min(0) },
      { end: min(130), start: min(100) },
    ])
  })
})

describe('activityInterval', () => {
  test('a point activity starts and ends at its time', () => {
    expect(activityInterval({ start_time: at(0) })).toEqual({ end: min(0), start: min(0) })
    expect(activityInterval({ end_time: at(20), start_time: at(0) })).toEqual({ end: min(20), start: min(0) })
  })
})

describe('sessions shorter than a bin', () => {
  test('a point activity and a two-minute entry both last five minutes', () => {
    expect(mergeIntoSessions([activityInterval({ start_time: at(3) })])).toEqual([
      { end: min(8), start: min(3) },
    ])
    expect(mergeIntoSessions([{ end: min(5), start: min(3) }])).toEqual([{ end: min(8), start: min(3) }])
  })

  test('a two-minute entry gets a during value', () => {
    const { timeline } = summarizeImpact(
      mergeIntoSessions([{ end: min(3), start: min(1) }]),
      only(bins([[5, 42]])),
      30,
    )
    expect(timeline.stress.during.mean).toBe(42)
  })
})

describe('windowStats', () => {
  test('averages per session, not per sample', () => {
    const stats = windowStats([[10, 10, 10, 10, 10, 10, 10, 10], [30], []])
    expect(stats.mean).toBe(20)
    expect(stats.occurrences).toBe(2)
    expect(stats.sample_count).toBe(9)
  })
})

describe('pairedEffect', () => {
  test('excludes sessions with data on one side only', () => {
    const effect = pairedEffect([10, 20, null, 40], [12, null, 30, 44])
    expect(effect.paired_occurrences).toBe(2)
    expect(effect.before_mean).toBe(25)
    expect(effect.after_mean).toBe(28)
    expect(effect.change).toBe(3)
    expect(effect.p_value).toBeNull()
  })

  test('change equals after_mean minus before_mean', () => {
    const effect = pairedEffect([50, 47, 44, 41], [40, 36, 35, 30])
    expect(effect.change).toBeCloseTo(effect.after_mean! - effect.before_mean!, 5)
  })

  test('a consistent drop gives a small p-value', () => {
    const before = [50, 52, 48, 51, 49, 53, 50, 47]
    const after = before.map((b, i) => b - 10 + (i % 2 === 0 ? 1 : -1))
    const effect = pairedEffect(before, after)
    expect(effect.change).toBe(-10)
    expect(effect.p_value).not.toBeNull()
    expect(effect.p_value!).toBeLessThan(0.001)
  })

  test('p-value is null when every difference is the same', () => {
    expect(pairedEffect([1, 2, 3, 4], [6, 7, 8, 9]).p_value).toBeNull()
  })

  test('no pairs gives nulls', () => {
    expect(pairedEffect([null], [5])).toEqual({
      after_mean: null,
      before_mean: null,
      change: null,
      change_stddev: null,
      p_value: null,
      paired_occurrences: 0,
    })
  })
})

describe('summarizeImpact', () => {
  test('a neighbouring session truncates the after-window', () => {
    const sessions = mergeIntoSessions([
      { end: min(30), start: min(0) },
      { end: min(80), start: min(50) },
    ])
    const stress = bins([
      [-20, 40],
      [35, 20],
      [55, 60],
    ])
    const { effects, timeline } = summarizeImpact(sessions, only(stress), 30)

    expect(timeline.stress.after15min.mean).toBe(20)
    expect(timeline.stress.after30min.mean).toBeNull()
    expect(effects.stress.paired_occurrences).toBe(1)
    expect(effects.stress.before_mean).toBe(40)
    expect(effects.stress.after_mean).toBe(20)
    expect(timeline.stress.during.mean).toBe(60)
  })

  test('a densely recorded session does not outweigh a sparse one', () => {
    const sessions = [
      { end: min(60), start: min(0) },
      { end: min(1060), start: min(1000) },
    ]
    const dense = Array.from({ length: 12 }, (_, i) => [i * 5, 100] as [number, number])
    const stress = bins([...dense, [1000, 40]])
    const { timeline } = summarizeImpact(sessions, only(stress), 30)

    expect(timeline.stress.during.mean).toBe(70)
    expect(timeline.stress.during.occurrences).toBe(2)
    expect(timeline.stress.during.sample_count).toBe(13)
  })

  test('the timeline halves split the window', () => {
    const sessions = [{ end: min(10), start: min(0) }]
    const stress = bins([
      [-25, 1],
      [-10, 2],
      [15, 3],
      [30, 4],
    ])
    const { effects, timeline } = summarizeImpact(sessions, only(stress), 30)

    expect(timeline.stress.before30min.mean).toBe(1)
    expect(timeline.stress.before15min.mean).toBe(2)
    expect(timeline.stress.after15min.mean).toBe(3)
    expect(timeline.stress.after30min.mean).toBe(4)
    expect(effects.stress.before_mean).toBe(1.5)
    expect(effects.stress.after_mean).toBe(3.5)
  })
})

const offsets = (window: number) =>
  timelineBuckets(window).map((b) => [b.phase, b.start_offset_minutes, b.end_offset_minutes])

describe('bins straddling a session boundary', () => {
  test('dense samples in the bin a session starts in stay out of the window before it', () => {
    const sessions = [{ end: min(33), start: min(3) }]
    const stress = binSeries([
      [at(-5), 30],
      ...Array.from({ length: 120 }, (_, s): [Date, number] => [new Date(min(3) + s * 1000), 90]),
      [at(7), 80],
      [at(36), 20],
    ])
    const { effects, timeline } = summarizeImpact(sessions, only(stress), 30)

    expect(effects.stress.before_mean).toBe(30)
    expect(timeline.stress.before15min.mean).toBe(30)
    expect(timeline.stress.during.mean).toBe(80)
    expect(effects.stress.after_mean).toBe(20)
  })

  test('the bin the next session starts in is not part of the window after', () => {
    const sessions = mergeIntoSessions([
      { end: min(30), start: min(0) },
      { end: min(80), start: min(52) },
    ])
    const stress = bins([
      [-10, 30],
      [40, 20],
      [50, 90],
    ])
    const { timeline } = summarizeImpact(sessions, only(stress), 30)

    expect(timeline.stress.after15min).toMatchObject({ mean: 20, occurrences: 1 })
    expect(timeline.stress.after30min.occurrences).toBe(0)
  })
})

describe('timelineBuckets', () => {
  test('two buckets per side below an hour, four from an hour', () => {
    expect(bucketsPerSide(30)).toBe(2)
    expect(bucketsPerSide(59)).toBe(2)
    expect(bucketsPerSide(60)).toBe(4)
    expect(bucketsPerSide(1440)).toBe(4)
  })

  test('a 30-minute window has 15-minute buckets around the session', () => {
    expect(offsets(30)).toEqual([
      ['before', -30, -15],
      ['before', -15, 0],
      ['during', 0, 0],
      ['after', 0, 15],
      ['after', 15, 30],
    ])
  })

  test('a 4-hour window has hour-long buckets', () => {
    expect(offsets(240)).toEqual([
      ['before', -240, -180],
      ['before', -180, -120],
      ['before', -120, -60],
      ['before', -60, 0],
      ['during', 0, 0],
      ['after', 0, 60],
      ['after', 60, 120],
      ['after', 120, 180],
      ['after', 180, 240],
    ])
  })
})

describe('summarizeImpact buckets', () => {
  test('each bucket averages the samples in its slice of the window', () => {
    const sessions = [{ end: min(30), start: min(0) }]
    const stress = bins([
      [-200, 1],
      [-150, 2],
      [-90, 3],
      [-30, 4],
      [10, 5],
      [60, 6],
      [90, 7],
      [150, 8],
      [235, 9],
    ])
    const { buckets } = summarizeImpact(sessions, only(stress), 240)

    expect(buckets.map((b) => b.stress.mean)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(buckets.map((b) => b.hrv.mean)).toEqual(Array.from({ length: 9 }, () => null))
    expect(buckets[0]).toMatchObject({
      end_offset_minutes: -180,
      phase: 'before',
      start_offset_minutes: -240,
    })
    expect(buckets[8]).toMatchObject({ end_offset_minutes: 240, phase: 'after', start_offset_minutes: 180 })
  })

  test('a neighbouring session clips an after-bucket', () => {
    const sessions = mergeIntoSessions([
      { end: min(30), start: min(0) },
      { end: min(130), start: min(100) },
    ])
    const stress = bins([
      [50, 20],
      [95, 30],
      [105, 60],
    ])
    const { buckets } = summarizeImpact(sessions, only(stress), 240)
    const after = buckets.filter((b) => b.phase === 'after')

    expect(after[0].stress).toMatchObject({ mean: 20, occurrences: 1 })
    expect(after[1].stress).toMatchObject({ mean: 30, occurrences: 1 })
    expect(after[2].stress.occurrences).toBe(0)
    expect(buckets.find((b) => b.phase === 'during')?.stress.mean).toBe(60)
  })

  test('the 30-minute buckets match the legacy timeline', () => {
    const sessions = mergeIntoSessions([
      { end: min(30), start: min(0) },
      { end: min(80), start: min(50) },
    ])
    const stress = bins([
      [-25, 1],
      [-10, 2],
      [5, 9],
      [35, 3],
      [45, 4],
      [100, 5],
    ])
    const { buckets, timeline } = summarizeImpact(sessions, only(stress), 30)

    expect(buckets.map((b) => b.stress)).toEqual([
      timeline.stress.before30min,
      timeline.stress.before15min,
      timeline.stress.during,
      timeline.stress.after15min,
      timeline.stress.after30min,
    ])
  })
})
