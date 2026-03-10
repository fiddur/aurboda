/**
 * Service for automatic calorie computation from HR data.
 *
 * Triggered after HR data is ingested (from Health Connect or Oura).
 * Computes per-minute calories using the HR-based formula and stores them
 * as calories_active with source 'aurboda', plus queues outbound sync.
 */

import type { BiologicalSex } from '@aurboda/api-spec'
import { enqueueOutboundSync, getUserSettings } from '../db'
import {
  deleteTimeSeriesBySource,
  getTimeSeries,
  getTimeSeriesWithSource,
  insertTimeSeries,
} from '../db/time-series'
import type { TimeSeriesPoint } from '../db/types'
import { isHealthConnectSyncableMetric, metricToHealthConnectType } from '../schema'
import { computeCaloriesPerMinute, getVo2MaxFallback } from './calories'

/**
 * Calculate age from birth date string.
 */
const calculateAge = (birthDate: string): number => {
  const birth = new Date(birthDate)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--
  }
  return age
}

/**
 * Get the most recent value for a metric before or at the given time.
 */
const getLatestMetricValue = async (
  user: string,
  metric: string,
  beforeTime: Date,
): Promise<number | null> => {
  // Look back up to 90 days for the latest value
  const lookbackStart = new Date(beforeTime.getTime() - 90 * 24 * 60 * 60 * 1000)
  const data = await getTimeSeries(user, metric, lookbackStart, beforeTime)
  if (data.length === 0) return null
  // Return the most recent value
  return data[data.length - 1][1]
}

export interface CalorieComputationResult {
  points_computed: number
  points_stored: number
  vo2_max_source: 'measured' | 'fallback'
  skipped_reason?: string
}

/**
 * Compute and store calories for a time range where HR data exists.
 *
 * This is the main entry point called after HR data ingestion.
 * It gathers all required inputs, computes per-minute calories,
 * stores them, and queues outbound sync.
 */
export const computeAndStoreCalories = async (
  user: string,
  start: Date,
  end: Date,
  options?: { force?: boolean },
): Promise<CalorieComputationResult> => {
  // 1. Get user settings
  const settings = await getUserSettings(user)
  if (!settings) {
    return { points_computed: 0, points_stored: 0, skipped_reason: 'no settings', vo2_max_source: 'fallback' }
  }

  const sex = settings.sex as BiologicalSex | undefined
  if (!sex) {
    return { points_computed: 0, points_stored: 0, skipped_reason: 'sex not set', vo2_max_source: 'fallback' }
  }

  if (!settings.birth_date) {
    return {
      points_computed: 0,
      points_stored: 0,
      skipped_reason: 'birth_date not set',
      vo2_max_source: 'fallback',
    }
  }

  const age = calculateAge(settings.birth_date)

  // 2. Get latest weight
  const weight = await getLatestMetricValue(user, 'weight', end)
  if (weight === null) {
    return {
      points_computed: 0,
      points_stored: 0,
      skipped_reason: 'no weight data',
      vo2_max_source: 'fallback',
    }
  }

  // 3. Get VO2 max (measured or fallback)
  const measuredVo2Max = await getLatestMetricValue(user, 'vo2_max', end)
  const vo2Max = measuredVo2Max ?? getVo2MaxFallback(sex, age)
  const vo2MaxSource = measuredVo2Max !== null ? 'measured' : 'fallback'

  // 4. Get HR data for the time range
  const hrData = await getTimeSeries(user, 'heart_rate', start, end)
  if (hrData.length === 0) {
    return {
      points_computed: 0,
      points_stored: 0,
      skipped_reason: 'no HR data',
      vo2_max_source: vo2MaxSource,
    }
  }

  // 5. Delete existing aurboda calories if force-recomputing
  if (options?.force) {
    await deleteTimeSeriesBySource(user, 'calories_active', 'aurboda', start, end)
  }

  // 6. Check if aurboda calories already exist for this range to avoid recomputing
  const existingCalories = await getTimeSeriesWithSource(user, 'calories_active', start, end)
  const existingAurbodaMinutes = new Set(
    existingCalories.filter((p) => p.source === 'aurboda').map((p) => Math.floor(p.time.getTime() / 60_000)),
  )

  // 6. Compute per-minute calories
  const caloriePoints = computeCaloriesPerMinute({
    age_years: age,
    hr_samples: hrData,
    sex,
    vo2_max: vo2Max,
    weight_kg: weight,
  })

  // 7. Filter out already-computed minutes
  const newPoints = caloriePoints.filter(
    (p) => !existingAurbodaMinutes.has(Math.floor(p.time.getTime() / 60_000)),
  )

  if (newPoints.length === 0) {
    return {
      points_computed: caloriePoints.length,
      points_stored: 0,
      skipped_reason: 'all minutes already computed',
      vo2_max_source: vo2MaxSource,
    }
  }

  // 8. Store as time_series
  const timeSeriesPoints: TimeSeriesPoint[] = newPoints.map((p) => ({
    metric: 'calories_active',
    source: 'aurboda' as const,
    time: p.time,
    unit: 'kcal',
    value: p.kcal,
  }))
  await insertTimeSeries(user, timeSeriesPoints)

  // 9. Queue outbound sync for each point (best-effort)
  try {
    if (isHealthConnectSyncableMetric('calories_active')) {
      const hcRecordType = metricToHealthConnectType.calories_active
      if (hcRecordType) {
        for (const p of newPoints) {
          await enqueueOutboundSync(user, {
            entity_id: `calories_active|${p.time.toISOString()}`,
            entity_type: 'time_series',
            hc_record_type: hcRecordType,
            operation: 'insert',
            payload: {
              end_time: p.end_time.toISOString(),
              metric: 'calories_active',
              time: p.time.toISOString(),
              unit: 'kcal',
              value: p.kcal,
            },
          })
        }
      }
    }
  } catch (err) {
    console.error('Failed to enqueue calorie outbound sync:', err)
  }

  return {
    points_computed: caloriePoints.length,
    points_stored: newPoints.length,
    vo2_max_source: vo2MaxSource,
  }
}

/**
 * Trigger calorie computation for a time range after HR data ingestion.
 * This is a best-effort operation that never throws.
 */
export const triggerCalorieComputation = async (user: string, start: Date, end: Date): Promise<void> => {
  try {
    const result = await computeAndStoreCalories(user, start, end)
    if (result.points_stored > 0) {
      console.log(
        `🔥 Computed ${result.points_stored} calorie data points for ${user} ` +
          `(VO2max: ${result.vo2_max_source})`,
      )
    }
  } catch (err) {
    console.error('Calorie computation failed (non-fatal):', err)
  }
}
