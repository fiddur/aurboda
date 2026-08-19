/**
 * Pure utility functions for sleep stage data parsing and display.
 *
 * Health Connect sleep stage values:
 *   1=Awake, 2=Sleeping/Unknown, 3=Out of bed, 4=Light, 5=Deep, 6=REM
 */

export interface SleepStage {
  startTime: string
  endTime: string
  stage: number
}

export const STAGE_LABELS: Record<number, string> = {
  1: 'Awake',
  2: 'Sleeping',
  3: 'Out of bed',
  4: 'Light',
  5: 'Deep',
  6: 'REM',
}

/** Stages that count as actual sleep time. */
const SLEEP_STAGES = new Set([2, 4, 5, 6])

/** Colors for hypnogram bands. */
export const STAGE_COLORS: Record<number, string> = {
  1: '#f59e0b', // Awake - amber
  2: '#94a3b8', // Sleeping/Unknown - slate gray
  3: '#9ca3af', // Out of bed - gray
  4: '#93c5fd', // Light - light blue
  5: '#4338ca', // Deep - indigo
  6: '#7c3aed', // REM - purple
}

/**
 * Y-axis positions for standard hypnogram ordering (top to bottom):
 * Awake (top) -> REM -> Light -> Deep (bottom)
 * Out of bed and unknown are treated as Awake level.
 */
export const STAGE_Y_ORDER: Record<number, number> = {
  1: 0, // Awake - top
  2: 2, // Sleeping/Unknown - Light level
  3: 0, // Out of bed - Awake level
  4: 2, // Light
  5: 3, // Deep - bottom
  6: 1, // REM
}

/** Extract validated sleep stages from activity data. */
export const parseSleepStages = (data: Record<string, unknown> | undefined): SleepStage[] => {
  if (!data) return []
  const stages = data.stages
  if (!Array.isArray(stages)) return []
  return stages.filter(
    (s): s is SleepStage =>
      typeof s === 'object' &&
      s !== null &&
      typeof s.startTime === 'string' &&
      typeof s.endTime === 'string' &&
      typeof s.stage === 'number' &&
      s.stage >= 1 &&
      s.stage <= 6,
  )
}

/** Compute actual sleep minutes from parsed stages. */
export const computeSleepMinutesFromStages = (stages: SleepStage[]): number => {
  let ms = 0
  for (const stage of stages) {
    if (SLEEP_STAGES.has(stage.stage)) {
      ms += new Date(stage.endTime).getTime() - new Date(stage.startTime).getTime()
    }
  }
  return Math.round(ms / 60000)
}

/** Format minutes as "Xh Ym". */
export const formatMinutesAsHM = (minutes: number): string => {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/** Metric keys used for sleep detail. */
export const SLEEP_METRICS = [
  'sleep_score',
  'sleep_efficiency',
  'sleep_restfulness',
  'sleep_deep_score',
  'sleep_rem_score',
] as const

export type SleepMetricKey = (typeof SLEEP_METRICS)[number]

export const SLEEP_METRIC_LABELS: Record<SleepMetricKey, string> = {
  sleep_deep_score: 'Deep',
  sleep_efficiency: 'Efficiency',
  sleep_rem_score: 'REM',
  sleep_restfulness: 'Restfulness',
  sleep_score: 'Score',
}

export const SLEEP_METRIC_UNITS: Record<SleepMetricKey, string> = {
  sleep_deep_score: '',
  sleep_efficiency: '%',
  sleep_rem_score: '',
  sleep_restfulness: '',
  sleep_score: '',
}
