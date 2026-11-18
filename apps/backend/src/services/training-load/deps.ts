/**
 * Dependencies injected into the training load read/write paths. Each method
 * abstracts a DB or external read so the pure compute logic can be unit tested
 * with simple stubs.
 */
import type { BiologicalSex, TrainingLoadSettings } from '@aurboda/api-spec'

import type { Activity, TimeSeriesPoint } from '../../db/types.ts'

export interface TrainingLoadDeps {
  /** Every workout type's sessions (exercise and its subtypes, custom exercise types), merged across sources */
  getExercises: (user: string, start: Date, end: Date) => Promise<Activity[]>
  /** Start of the user's earliest workout, of any workout type */
  getEarliestExerciseStart: (user: string) => Promise<Date | undefined>
  /** Activity type name → display name */
  getActivityTypeDisplayNames: (user: string) => Promise<Map<string, string>>
  /** Get HR time-series data in a time range (bucketed to 5-min) */
  getHrSamples: (user: string, start: Date, end: Date) => Promise<[Date, number][]>
  /** `getHrSamples` for many windows in one round trip; the result is index-aligned with `windows` */
  getHrSamplesForWindows: (user: string, windows: { start: Date; end: Date }[]) => Promise<[Date, number][][]>
  /** Get active calorie time-series data (raw samples) */
  getActiveCalories: (user: string, start: Date, end: Date) => Promise<[Date, number][]>
  /** Get active calories summed per hour (DB-level aggregation) */
  getHourlyCalorieSums: (user: string, start: Date, end: Date) => Promise<[Date, number][]>
  /** Get pre-computed impulse buckets from time_series */
  getImpulseBuckets: (user: string, metric: string, start: Date, end: Date) => Promise<[Date, number][]>
  /** Write impulse buckets to time_series */
  writeImpulseBuckets: (user: string, points: TimeSeriesPoint[]) => Promise<void>
  /** Delete impulse buckets in a range (for recomputation) */
  deleteImpulseBuckets: (
    user: string,
    metric: string,
    source: string,
    start: Date,
    end: Date,
  ) => Promise<number>
  getMaxObservedHr: (user: string) => Promise<number | undefined>
  getLatestRestingHr: (user: string) => Promise<number | undefined>
  getUserSettings: (user: string) => Promise<{
    training_load?: TrainingLoadSettings
    sex?: BiologicalSex
    birth_date?: string
  }>
  /** Update training load settings (for watermark) */
  updateTrainingLoadSettings: (user: string, update: Partial<TrainingLoadSettings>) => Promise<void>
  /**
   * Per user, the earliest hour (epoch ms) an auto-bootstrap recompute has already covered, and
   * when it ran (epoch ms). A user with no exercise or calorie data gets no buckets written, so
   * without this every read would bootstrap again.
   */
  bootstrappedFrom: Map<string, { at: number; fromHour: number }>
  /** Per user, the impulse recompute running in this process; a read joins it rather than starting another. */
  recomputing: Map<string, Promise<void>>
  /** How long (ms) a read waits for a recompute before answering with `recomputing: true`. */
  recomputeWaitMs: number
  /** Reports a recompute that failed; one that no read waits for any more fails nowhere else. */
  onRecomputeError: (user: string, error: unknown) => void
}

import {
  deleteTimeSeriesBySource,
  getActivityTypeDefinitions,
  getLatestTimeSeriesValue,
  getTimeSeries,
  getTimeSeriesBucketed,
  getTimeSeriesBucketedAvgForWindows,
  getTimeSeriesStats,
  insertTimeSeries,
} from '../../db/index.ts'
import { upsertUserSettings } from '../../db/settings.ts'
import { auditError } from '../audit-log.ts'
import { getSettings } from '../settings.ts'
import { getEarliestWorkoutStart, getWorkoutActivities } from '../workout-activities.ts'

const processBootstrappedFrom: TrainingLoadDeps['bootstrappedFrom'] = new Map()
const processRecomputing: TrainingLoadDeps['recomputing'] = new Map()

export const createTrainingLoadDeps = (): TrainingLoadDeps => ({
  bootstrappedFrom: processBootstrappedFrom,

  deleteImpulseBuckets: async (user, metric, source, start, end) => {
    return deleteTimeSeriesBySource(user, metric, source, start, end)
  },

  getActiveCalories: async (user, start, end) => {
    const samples = await getTimeSeries(user, 'calories_active', start, end)
    return samples
  },

  getActivityTypeDisplayNames: async (user) =>
    new Map((await getActivityTypeDefinitions(user)).map((d) => [d.name, d.display_name])),

  getEarliestExerciseStart: getEarliestWorkoutStart,

  getExercises: getWorkoutActivities,

  getHourlyCalorieSums: async (user, start, end) => {
    const buckets = await getTimeSeriesBucketed(user, ['calories_active'], start, end, '60 minutes')
    return buckets.map((b) => [b.bucket_start, b.sum] as [Date, number])
  },

  getHrSamples: async (user, start, end) => {
    const buckets = await getTimeSeriesBucketed(user, ['heart_rate'], start, end, '5 minutes')
    return buckets.map((b) => [b.bucket_start, b.avg] as [Date, number])
  },

  getHrSamplesForWindows: async (user, windows) =>
    getTimeSeriesBucketedAvgForWindows(user, 'heart_rate', windows, '5 minutes'),

  getImpulseBuckets: async (user, metric, start, end) => {
    return getTimeSeries(user, metric, start, end)
  },

  getLatestRestingHr: async (user) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    return getLatestTimeSeriesValue(user, 'resting_heart_rate', thirtyDaysAgo)
  },

  getMaxObservedHr: async (user) => {
    const now = new Date()
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
    const stats = await getTimeSeriesStats(user, ['heart_rate'], oneYearAgo, now)
    const hrStats = stats.find((s) => s.metric === 'heart_rate')
    if (!hrStats || hrStats.count === 0) return undefined
    return hrStats.max
  },

  getUserSettings: async (user) => {
    const s = await getSettings(user)
    return {
      birth_date: s.birth_date,
      sex: s.sex,
      training_load: s.training_load,
    }
  },

  onRecomputeError: (user, error) => {
    auditError(user, 'data', 'Training load recompute failed', { error: String(error) })
  },

  recomputeWaitMs: 5000,

  recomputing: processRecomputing,

  updateTrainingLoadSettings: async (user, update) => {
    const current = await getSettings(user)
    await upsertUserSettings(user, {
      training_load: { ...current.training_load, ...update },
    })
  },

  writeImpulseBuckets: async (user, points) => {
    await insertTimeSeries(user, points)
  },
})
