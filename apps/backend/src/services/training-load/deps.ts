/**
 * Dependencies injected into the training load read/write paths. Each method
 * abstracts a DB or external read so the pure compute logic can be unit tested
 * with simple stubs.
 */
import type { BiologicalSex, TrainingLoadSettings } from '@aurboda/api-spec'

import type { Activity, TimeSeriesPoint } from '../../db/types.ts'

export interface TrainingLoadDeps {
  /** Get exercise activities in a time range */
  getExercises: (user: string, start: Date, end: Date) => Promise<Activity[]>
  /** Get HR time-series data in a time range (bucketed to 5-min) */
  getHrSamples: (user: string, start: Date, end: Date) => Promise<[Date, number][]>
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
  /** Get the maximum observed HR value */
  getMaxObservedHr: (user: string) => Promise<number | undefined>
  /** Get the most recent resting HR */
  getLatestRestingHr: (user: string) => Promise<number | undefined>
  /** Get user settings */
  getUserSettings: (user: string) => Promise<{
    training_load?: TrainingLoadSettings
    sex?: BiologicalSex
    birth_date?: string
  }>
  /** Update training load settings (for watermark) */
  updateTrainingLoadSettings: (user: string, update: Partial<TrainingLoadSettings>) => Promise<void>
}

import {
  deleteTimeSeriesBySource,
  getActivities,
  getTimeSeries,
  getTimeSeriesBucketed,
  getTimeSeriesStats,
  insertTimeSeries,
} from '../../db/index.ts'
import { upsertUserSettings } from '../../db/settings.ts'
import { getSettings } from '../settings.ts'

/**
 * Create production dependencies for the training load computation.
 */
export const createTrainingLoadDeps = (): TrainingLoadDeps => ({
  deleteImpulseBuckets: async (user, metric, source, start, end) => {
    return deleteTimeSeriesBySource(user, metric, source, start, end)
  },

  getActiveCalories: async (user, start, end) => {
    const samples = await getTimeSeries(user, 'calories_active', start, end)
    return samples
  },

  getExercises: async (user, start, end) => {
    return getActivities(user, 'exercise', start, end)
  },

  getHourlyCalorieSums: async (user, start, end) => {
    const buckets = await getTimeSeriesBucketed(user, ['calories_active'], start, end, '60 minutes')
    return buckets.map((b) => [b.bucket_start, b.sum] as [Date, number])
  },

  getHrSamples: async (user, start, end) => {
    const buckets = await getTimeSeriesBucketed(user, ['heart_rate'], start, end, '5 minutes')
    return buckets.map((b) => [b.bucket_start, b.avg] as [Date, number])
  },

  getImpulseBuckets: async (user, metric, start, end) => {
    return getTimeSeries(user, metric, start, end)
  },

  getLatestRestingHr: async (user) => {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const samples = await getTimeSeries(user, 'resting_heart_rate', thirtyDaysAgo, now)
    if (samples.length === 0) return undefined
    return samples[samples.length - 1][1]
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
