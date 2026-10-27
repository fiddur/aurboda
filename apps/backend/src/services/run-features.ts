import type { ActivityFeatures, HrZoneThresholds } from '@aurboda/api-spec'

import { MAX_GAP_SECONDS, SINGLE_SAMPLE_SECONDS } from '../hr-zone-constants.ts'
import { computeHrZoneSecs } from './settings.ts'

export type RunFeatures = Omit<ActivityFeatures, 'activity_id' | 'computed_at'>

type Samples = [Date, number][]

export interface FeatureInput {
  start: Date
  end: Date
  hr: Samples
  speed: Samples
  track?: { points: { alt: number; t: number }[]; length_m: number } | null
  zones: HrZoneThresholds
  lowHrCeilingBpm: number
  medianDuration90dS?: number
}

const MOVING_SPEED_MS = 0.5
/** Pace variability ignores walking and stops, which would read a jog-walk as erratic pacing. */
const PACE_SPEED_MS = 1.5
const MIN_DRIFT_HALF_SAMPLES = 10
const MIN_PACE_SAMPLES = 30
const WORK_BLOCK_MIN_S = 30
const WORK_BLOCK_MAX_S = 8 * 60
const ELEVATION_SMOOTHING_POINTS = 5
const ELEVATION_HYSTERESIS_M = 3

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0)

const mean = (values: number[]): number | null => (values.length === 0 ? null : sum(values) / values.length)

export const median = (values: number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export const coefficientOfVariation = (values: number[]): number | null => {
  const m = mean(values)
  if (m === null || m === 0) return null
  const variance = sum(values.map((v) => (v - m) ** 2)) / values.length
  return Math.sqrt(variance) / m
}

/** Same gap rule as `computeHrZoneSecs`: the gap to the next sample capped, the last sample the mean gap. */
export const sampleDurations = (samples: Samples): number[] => {
  if (samples.length === 0) return []
  if (samples.length === 1) return [SINGLE_SAMPLE_SECONDS]
  const gaps = samples
    .slice(0, -1)
    .map(([time], i) => Math.min((samples[i + 1][0].getTime() - time.getTime()) / 1000, MAX_GAP_SECONDS))
  return [...gaps, Math.min(sum(gaps) / gaps.length, MAX_GAP_SECONDS)]
}

export const elapsedSeconds = (start: Date, end: Date): number => (end.getTime() - start.getTime()) / 1000

export const movingSeconds = (speed: Samples, elapsedS: number): number => {
  if (speed.length === 0) return elapsedS
  const durations = sampleDurations(speed)
  return sum(speed.map(([, v], i) => (v > MOVING_SPEED_MS ? durations[i] : 0)))
}

export const zoneFractions = (
  hr: Samples,
  zones: HrZoneThresholds,
): Pick<
  RunFeatures,
  | 'zone0_fraction'
  | 'zone1_fraction'
  | 'zone2_fraction'
  | 'zone3_fraction'
  | 'zone4_fraction'
  | 'zone5_fraction'
> => {
  const secs = computeHrZoneSecs(hr, zones)
  const total = secs[0] + secs[1] + secs[2] + secs[3] + secs[4] + secs[5]
  const fraction = (s: number) => (total > 0 ? s / total : null)
  return {
    zone0_fraction: fraction(secs[0]),
    zone1_fraction: fraction(secs[1]),
    zone2_fraction: fraction(secs[2]),
    zone3_fraction: fraction(secs[3]),
    zone4_fraction: fraction(secs[4]),
    zone5_fraction: fraction(secs[5]),
  }
}

export const lowHrFraction = (hr: Samples, ceilingBpm: number): number | null => {
  const durations = sampleDurations(hr)
  const total = sum(durations)
  if (total === 0) return null
  return sum(hr.map(([, bpm], i) => (bpm <= ceilingBpm ? durations[i] : 0))) / total
}

/**
 * Aerobic decoupling. With speed samples, a half without any moving sample gives null rather than
 * silently falling back to HR alone, which would read a stop as drift.
 */
export const hrDriftPct = (hr: Samples, speed: Samples, start: Date, end: Date): number | null => {
  const midpoint = (start.getTime() + end.getTime()) / 2
  const firstHalf = (samples: Samples) => samples.filter(([t]) => t.getTime() < midpoint).map(([, v]) => v)
  const secondHalf = (samples: Samples) => samples.filter(([t]) => t.getTime() >= midpoint).map(([, v]) => v)
  const hr1 = firstHalf(hr)
  const hr2 = secondHalf(hr)
  if (hr1.length < MIN_DRIFT_HALF_SAMPLES || hr2.length < MIN_DRIFT_HALF_SAMPLES) return null
  const meanHr1 = mean(hr1) as number
  const meanHr2 = mean(hr2) as number
  if (meanHr1 === 0) return null
  if (speed.length === 0) return (meanHr2 / meanHr1 - 1) * 100
  const moving = (values: number[]) => values.filter((v) => v > MOVING_SPEED_MS)
  const speed1 = mean(moving(firstHalf(speed)))
  const speed2 = mean(moving(secondHalf(speed)))
  if (speed1 === null || speed2 === null) return null
  return (meanHr2 / speed2 / (meanHr1 / speed1) - 1) * 100
}

/** For each sample, the mean speed over the trailing window of samples (inclusive). */
export const smoothedSpeed = (speed: Samples, windowS = 30): Samples => {
  let from = 0
  return speed.map(([time], i) => {
    const cutoff = time.getTime() - windowS * 1000
    while (speed[from][0].getTime() < cutoff) from++
    return [time, mean(speed.slice(from, i + 1).map(([, v]) => v)) as number]
  })
}

const paceSecPerKm = (speedMs: number): number => 1000 / speedMs

export const paceCv = (smoothed: Samples): number | null => {
  const paces = smoothed.filter(([, v]) => v >= PACE_SPEED_MS).map(([, v]) => paceSecPerKm(v))
  if (paces.length < MIN_PACE_SAMPLES) return null
  return coefficientOfVariation(paces)
}

interface SpeedBlock {
  fast: boolean
  duration_s: number
  speeds: number[]
}

const speedBlocks = (smoothed: Samples): SpeedBlock[] => {
  const movingSpeeds = smoothed.filter(([, v]) => v > MOVING_SPEED_MS).map(([, v]) => v)
  const threshold = median(movingSpeeds)
  if (threshold === null) return []
  const durations = sampleDurations(smoothed)
  const blocks: SpeedBlock[] = []
  let current: SpeedBlock | null = null
  smoothed.forEach(([, v], i) => {
    if (v <= MOVING_SPEED_MS) {
      current = null
      return
    }
    const fast = v > threshold
    if (current === null || current.fast !== fast) {
      current = { duration_s: 0, fast, speeds: [] }
      blocks.push(current)
    }
    current.duration_s += durations[i]
    current.speeds.push(v)
  })
  return blocks
}

const isWorkBlock = (block: SpeedBlock): boolean =>
  block.fast && block.duration_s >= WORK_BLOCK_MIN_S && block.duration_s <= WORK_BLOCK_MAX_S

const blockPace = (block: SpeedBlock): number => paceSecPerKm(mean(block.speeds) as number)

export type IntervalFeatures = Pick<
  RunFeatures,
  'interval_count' | 'work_block_median_s' | 'rest_block_median_s' | 'work_block_cv' | 'work_rest_pace_ratio'
>

export const detectIntervals = (smoothed: Samples): IntervalFeatures => {
  if (smoothed.length === 0) {
    return {
      interval_count: null,
      rest_block_median_s: null,
      work_block_cv: null,
      work_block_median_s: null,
      work_rest_pace_ratio: null,
    }
  }
  const blocks = speedBlocks(smoothed)
  const workIndexes = blocks.flatMap((block, i) => (isWorkBlock(block) ? [i] : []))
  const work = workIndexes.map((i) => blocks[i])
  const rest =
    workIndexes.length < 2
      ? []
      : blocks.slice(workIndexes[0] + 1, workIndexes[workIndexes.length - 1]).filter((block) => !block.fast)
  const workPace = median(work.map(blockPace))
  const restPace = median(rest.map(blockPace))
  return {
    interval_count: work.length,
    rest_block_median_s: median(rest.map((b) => b.duration_s)),
    work_block_cv: work.length < 2 ? null : coefficientOfVariation(work.map((b) => b.duration_s)),
    work_block_median_s: median(work.map((b) => b.duration_s)),
    work_rest_pace_ratio: workPace === null || restPace === null ? null : restPace / workPace,
  }
}

const movingAverage = (values: number[], points: number): number[] => {
  const half = Math.floor(points / 2)
  return values.map((_, i) => mean(values.slice(Math.max(0, i - half), i + half + 1)) as number)
}

export const elevationFeatures = (
  track: FeatureInput['track'],
): Pick<RunFeatures, 'elevation_gain_m' | 'elevation_oscillation'> => {
  const none = { elevation_gain_m: null, elevation_oscillation: null }
  if (!track || track.points.length === 0 || track.points.every((p) => p.alt === 0)) return none
  // With real altitudes around, a zero is a missing fix, not sea level.
  const altitudes = track.points.map((p) => p.alt).filter((alt) => alt !== 0)
  const smoothed = movingAverage(altitudes, ELEVATION_SMOOTHING_POINTS)
  let reference = smoothed[0]
  let gain = 0
  let loss = 0
  for (const alt of smoothed.slice(1)) {
    const delta = alt - reference
    if (delta > ELEVATION_HYSTERESIS_M) {
      gain += delta
      reference = alt
    } else if (delta < -ELEVATION_HYSTERESIS_M) {
      loss -= delta
      reference = alt
    }
  }
  return {
    elevation_gain_m: gain,
    elevation_oscillation: track.length_m > 0 ? (gain + loss) / (track.length_m / 1000) : null,
  }
}

export const durationVsMedian = (elapsedS: number, medianS: number | undefined): number | null =>
  medianS ? elapsedS / medianS : null

export const computeRunFeatures = (input: FeatureInput): RunFeatures => {
  const elapsed = elapsedSeconds(input.start, input.end)
  const smoothed = smoothedSpeed(input.speed)
  const hasHr = input.hr.length > 0
  return {
    ...zoneFractions(input.hr, input.zones),
    ...detectIntervals(smoothed),
    ...elevationFeatures(input.track),
    duration_vs_median_90d: durationVsMedian(elapsed, input.medianDuration90dS),
    elapsed_s: elapsed,
    hr_drift_pct: hrDriftPct(input.hr, input.speed, input.start, input.end),
    low_hr_ceiling_bpm: input.lowHrCeilingBpm,
    low_hr_fraction: hasHr ? lowHrFraction(input.hr, input.lowHrCeilingBpm) : null,
    moving_s: movingSeconds(input.speed, elapsed),
    pace_cv: paceCv(smoothed),
  }
}
