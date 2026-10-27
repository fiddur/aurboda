import type { HrZoneThresholds } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  computeRunFeatures,
  detectIntervals,
  elevationFeatures,
  type FeatureInput,
  hrDriftPct,
  lowHrFraction,
  median,
  movingSeconds,
  paceCv,
  sampleDurations,
  smoothedSpeed,
} from './run-features.ts'

const zones: HrZoneThresholds = { 1: 95, 2: 114, 3: 133, 4: 152, 5: 171 }
const start = new Date('2026-06-01T06:00:00Z')
const at = (s: number) => new Date(start.getTime() + s * 1000)

const series = (durationS: number, stepS: number, value: (t: number) => number): [Date, number][] =>
  Array.from({ length: Math.floor(durationS / stepS) }, (_, i) => [at(i * stepS), value(i * stepS)])

const input = (overrides: Partial<FeatureInput>): FeatureInput => ({
  end: at(3600),
  hr: [],
  lowHrCeilingBpm: 133,
  speed: [],
  start,
  zones,
  ...overrides,
})

describe('sampleDurations', () => {
  test('gaps are capped and the last sample gets the mean gap', () => {
    expect(
      sampleDurations([
        [at(0), 1],
        [at(10), 1],
        [at(200), 1],
      ]),
    ).toEqual([10, 60, 35])
  })

  test('a single sample counts one second', () => {
    expect(sampleDurations([[at(0), 1]])).toEqual([1])
  })
})

describe('median', () => {
  test('odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('steady run', () => {
  const features = computeRunFeatures(
    input({
      hr: series(3600, 5, () => 140),
      medianDuration90dS: 1800,
      speed: series(3600, 5, () => 3),
    }),
  )

  test('zone fractions sum to 1, all in zone 3', () => {
    const fractions = [0, 1, 2, 3, 4, 5].map(
      (z) => features[`zone${z}_fraction` as `zone${0 | 1 | 2 | 3 | 4 | 5}_fraction`] as number,
    )
    expect(fractions.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    expect(features.zone3_fraction).toBeCloseTo(1)
  })

  test('no pace variation, no intervals, no drift', () => {
    expect(features.pace_cv).toBeCloseTo(0)
    expect(features.interval_count).toBe(0)
    expect(features.work_block_median_s).toBeNull()
    expect(features.work_rest_pace_ratio).toBeNull()
    expect(features.hr_drift_pct).toBeCloseTo(0)
  })

  test('elapsed, moving, low-HR share and duration ratio', () => {
    expect(features.elapsed_s).toBe(3600)
    expect(features.moving_s).toBe(3600)
    expect(features.low_hr_ceiling_bpm).toBe(133)
    expect(features.low_hr_fraction).toBe(0)
    expect(features.duration_vs_median_90d).toBe(2)
  })

  test('elevation is null without a track', () => {
    expect(features.elevation_gain_m).toBeNull()
    expect(features.elevation_oscillation).toBeNull()
  })
})

describe('interval session', () => {
  const warmUp = 300
  const phase = 120
  const speedAt = (t: number) => {
    if (t < warmUp || t >= warmUp + 12 * phase) return 2.5
    return Math.floor((t - warmUp) / phase) % 2 === 0 ? 4 : 2.5
  }
  const duration = 2 * warmUp + 12 * phase
  const speed = series(duration, 1, speedAt)

  test('six work blocks, work faster than rest, regular blocks', () => {
    const features = computeRunFeatures(input({ end: at(duration), speed }))
    expect(features.interval_count).toBe(6)
    expect(features.work_rest_pace_ratio).toBeGreaterThan(1.12)
    expect(features.work_block_cv).toBeLessThan(0.05)
    expect(features.work_block_median_s).toBeGreaterThan(100)
    expect(features.work_block_median_s).toBeLessThan(180)
    expect(features.rest_block_median_s).toBeGreaterThan(60)
    expect(features.pace_cv).toBeGreaterThan(0.1)
  })

  test('a stop ends a block: a work block cut in two counts twice', () => {
    const stopped = smoothedSpeed(speed).map(([t, v]): [Date, number] => {
      const s = (t.getTime() - start.getTime()) / 1000
      return [t, s >= warmUp + 50 && s < warmUp + 60 ? 0 : v]
    })
    expect(detectIntervals(stopped).interval_count).toBe(7)
  })

  test('fast blocks longer than eight minutes are not work blocks', () => {
    const tempo = series(1800, 1, (t) => (t >= 300 && t < 1000 ? 4 : 2.5))
    expect(detectIntervals(smoothedSpeed(tempo)).interval_count).toBe(0)
  })
})

describe('drifting run', () => {
  test('second-half HR up 8 % at the same speed', () => {
    const features = computeRunFeatures(
      input({
        hr: series(3600, 5, (t) => (t < 1800 ? 140 : 151.2)),
        speed: series(3600, 5, () => 3),
      }),
    )
    expect(features.hr_drift_pct).toBeCloseTo(8)
  })

  test('slower second half at the same HR also decouples', () => {
    const drift = hrDriftPct(
      series(3600, 5, () => 140),
      series(3600, 5, (t) => (t < 1800 ? 3 : 2.5)),
      start,
      at(3600),
    )
    expect(drift).toBeCloseTo(20)
  })

  test('HR alone without speed', () => {
    expect(
      hrDriftPct(
        series(3600, 5, (t) => (t < 1800 ? 100 : 110)),
        [],
        start,
        at(3600),
      ),
    ).toBeCloseTo(10)
  })

  test('null with too few HR samples in a half', () => {
    expect(
      hrDriftPct(
        series(3600, 600, () => 140),
        [],
        start,
        at(3600),
      ),
    ).toBeNull()
  })
})

describe('missing data', () => {
  test('no HR: the HR features are null', () => {
    const features = computeRunFeatures(input({ speed: series(3600, 5, () => 3) }))
    expect(features.zone0_fraction).toBeNull()
    expect(features.zone5_fraction).toBeNull()
    expect(features.low_hr_fraction).toBeNull()
    expect(features.hr_drift_pct).toBeNull()
  })

  test('no speed: moving equals elapsed and the pace features are null', () => {
    const features = computeRunFeatures(input({ hr: series(3600, 5, () => 120) }))
    expect(features.moving_s).toBe(3600)
    expect(features.pace_cv).toBeNull()
    expect(features.interval_count).toBeNull()
    expect(features.work_block_median_s).toBeNull()
    expect(features.work_block_cv).toBeNull()
    expect(features.duration_vs_median_90d).toBeNull()
    expect(features.low_hr_fraction).toBe(1)
  })
})

describe('movingSeconds', () => {
  test('counts only samples above 0.5 m/s', () => {
    expect(
      movingSeconds(
        series(100, 10, (t) => (t < 50 ? 3 : 0)),
        100,
      ),
    ).toBe(50)
  })
})

describe('lowHrFraction', () => {
  test('share of time at or below the ceiling', () => {
    expect(
      lowHrFraction(
        series(100, 10, (t) => (t < 30 ? 130 : 140)),
        130,
      ),
    ).toBeCloseTo(0.3)
  })
})

describe('elevationFeatures', () => {
  const sawtooth = (cycles: number, amplitude: number) =>
    Array.from({ length: cycles * 40 + 1 }, (_, i) => {
      const phase = i % 40
      return { alt: 100 + (phase <= 20 ? phase : 40 - phase) * (amplitude / 20), t: i * 10 }
    })

  test('a sawtooth climbs and descends each cycle', () => {
    const { elevation_gain_m, elevation_oscillation } = elevationFeatures({
      length_m: 5000,
      points: sawtooth(5, 20),
    })
    expect(elevation_gain_m).toBeGreaterThan(70)
    expect(elevation_gain_m).toBeLessThanOrEqual(100)
    expect(elevation_oscillation).toBeGreaterThan(28)
    expect(elevation_oscillation).toBeLessThanOrEqual(40)
  })

  test('noise under the hysteresis does not count', () => {
    const points = Array.from({ length: 200 }, (_, i) => ({ alt: 50 + (i % 2 === 0 ? 1 : -1), t: i }))
    expect(elevationFeatures({ length_m: 1000, points }).elevation_gain_m).toBe(0)
  })

  test('zeros among real altitudes are missing fixes, not climbs', () => {
    const points = Array.from({ length: 200 }, (_, i) => ({ alt: i % 25 === 7 ? 0 : 120, t: i }))
    expect(elevationFeatures({ length_m: 1000, points })).toEqual({
      elevation_gain_m: 0,
      elevation_oscillation: 0,
    })
  })

  test('null when every altitude is 0 or there is no track', () => {
    expect(
      elevationFeatures({
        length_m: 1000,
        points: [
          { alt: 0, t: 0 },
          { alt: 0, t: 1 },
        ],
      }),
    ).toEqual({
      elevation_gain_m: null,
      elevation_oscillation: null,
    })
    expect(elevationFeatures(null).elevation_gain_m).toBeNull()
  })
})

describe('paceCv', () => {
  test('ignores samples under 1.5 m/s, so walk breaks do not read as erratic pacing', () => {
    const jogWalk = series(1200, 1, (t) => (Math.floor(t / 120) % 2 === 0 ? 3 : 1.2))
    expect(paceCv(jogWalk)).toBeCloseTo(0)
    expect(paceCv(series(1200, 1, () => 1.2))).toBeNull()
  })

  test('still sees variation among running samples', () => {
    const fartlek = series(1200, 1, (t) => (Math.floor(t / 120) % 2 === 0 ? 4 : 2.5))
    expect(paceCv(fartlek)).toBeGreaterThan(0.1)
  })
})
