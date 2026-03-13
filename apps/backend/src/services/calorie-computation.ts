/**
 * Service for automatic calorie computation from HR data.
 *
 * Triggered after HR data is ingested (from Health Connect or Oura).
 * Computes per-minute calories using the HR-based formula and stores them
 * as calories_active with source 'aurboda', plus queues outbound sync.
 */

import type { BiologicalSex } from '@aurboda/api-spec'
import { enqueueOutboundSync, getUserSettings, upsertUserSettings } from '../db'
import {
  deleteTimeSeriesBySource,
  getMetricTimeRange,
  getTimeSeries,
  getTimeSeriesBySource,
  getTimeSeriesWithSource,
  insertTimeSeries,
} from '../db/time-series'
import type { TimeSeriesPoint } from '../db/types'
import { isHealthConnectSyncableMetric, metricToHealthConnectType } from '../schema'
import {
  type CalorieDataPoint,
  computeCaloriesPerMinute,
  computeGapFillPoints,
  getVo2MaxFallback,
} from './calories'
import { getSettings } from './settings'

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
  lookbackDays = 90,
): Promise<number | null> => {
  const lookbackStart = new Date(beforeTime.getTime() - lookbackDays * 24 * 60 * 60 * 1000)
  const data = await getTimeSeries(user, metric, lookbackStart, beforeTime)
  if (data.length === 0) return null
  // Return the most recent value
  return data[data.length - 1][1]
}

/** Queue outbound sync entries for calorie data points (best-effort). */
const enqueueCalorieSync = async (
  user: string,
  points: { time: Date; end_time: Date; kcal: number }[],
): Promise<void> => {
  try {
    if (!isHealthConnectSyncableMetric('calories_active')) return
    const hcRecordType = metricToHealthConnectType.calories_active
    if (!hcRecordType) return
    for (const p of points) {
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
  } catch (err) {
    console.error('Failed to enqueue calorie outbound sync:', err)
  }
}

/**
 * Invalidate training load impulse buckets so they get recomputed from
 * the updated calorie data on next query.
 *
 * Sets impulse_watermark to the earliest of the given time and any existing
 * watermark, ensuring recomputation covers the full affected range.
 */
const invalidateTrainingLoadImpulses = async (user: string, fromTime: Date): Promise<void> => {
  try {
    const settings = await getSettings(user)
    const existingWatermark = settings.training_load?.impulse_watermark
    const existingTime = existingWatermark ? new Date(existingWatermark) : null
    const effectiveTime = existingTime && existingTime < fromTime ? existingTime : fromTime
    await upsertUserSettings(user, {
      training_load: { ...settings.training_load, impulse_watermark: effectiveTime.toISOString() },
    })
  } catch (err) {
    console.error('Failed to invalidate training load impulses:', err)
  }
}

const skippedResult = (
  reason: string,
  vo2MaxSource: 'measured' | 'fallback' = 'fallback',
): CalorieComputationResult => ({
  points_computed: 0,
  points_stored: 0,
  skipped_reason: reason,
  vo2_max_source: vo2MaxSource,
})

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
  // 1. Get user settings and validate required fields
  const settings = await getUserSettings(user)
  if (!settings) return skippedResult('no settings')

  const sex = settings.sex as BiologicalSex | undefined
  if (!sex) return skippedResult('sex not set')
  if (!settings.birth_date) return skippedResult('birth_date not set')

  const age = calculateAge(settings.birth_date)

  // 2. Get latest weight
  const weight = await getLatestMetricValue(user, 'weight', end)
  if (weight === null) return skippedResult('no weight data')

  // 3. Get VO2 max (measured or fallback) — use 2-year lookback since VO2 max is measured infrequently
  const measuredVo2Max = await getLatestMetricValue(user, 'vo2_max', end, 730)
  const vo2Max = measuredVo2Max ?? getVo2MaxFallback(sex, age)
  const vo2MaxSource = measuredVo2Max !== null ? 'measured' : 'fallback'

  // 4. Get resting HR (for baseline subtraction)
  const restingHr = await getLatestMetricValue(user, 'resting_heart_rate', end)

  // 5. Get HR data for the time range
  const hrData = await getTimeSeries(user, 'heart_rate', start, end)
  if (hrData.length === 0) return skippedResult('no HR data', vo2MaxSource)

  // 6. Delete existing aurboda calories if force-recomputing
  if (options?.force) {
    await deleteTimeSeriesBySource(user, 'calories_active', 'aurboda', start, end)
  }

  // 7. Check if aurboda calories already exist for this range to avoid recomputing
  const existingCalories = await getTimeSeriesWithSource(user, 'calories_active', start, end)
  const existingAurbodaMinutes = new Set(
    existingCalories.filter((p) => p.source === 'aurboda').map((p) => Math.floor(p.time.getTime() / 60_000)),
  )

  // 8. Compute per-minute calories (active only, with baseline subtraction)
  const caloriePoints = computeCaloriesPerMinute({
    age_years: age,
    hr_samples: hrData,
    resting_hr: restingHr ?? undefined,
    sex,
    vo2_max: vo2Max,
    weight_kg: weight,
  })

  // 9. Filter out already-computed minutes
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

  // 10. Store as time_series
  const timeSeriesPoints: TimeSeriesPoint[] = newPoints.map((p) => ({
    metric: 'calories_active',
    source: 'aurboda' as const,
    time: p.time,
    unit: 'kcal',
    value: p.kcal,
  }))
  await insertTimeSeries(user, timeSeriesPoints)

  // 11. Queue outbound sync (best-effort)
  await enqueueCalorieSync(user, newPoints)

  // 12. Invalidate training load impulse buckets so they recompute from new calorie data
  await invalidateTrainingLoadImpulses(user, start)

  return {
    points_computed: caloriePoints.length,
    points_stored: newPoints.length,
    vo2_max_source: vo2MaxSource,
  }
}

export interface GapFillDayResult {
  gap_minutes: number
  residual_kcal: number
  points_stored: number
}

/**
 * Gap-fill calories for a single calendar day (UTC).
 *
 * After aurboda per-minute calories are computed from HR data, some minutes
 * may have no HR coverage (e.g., Oura wrist off, no HR monitor worn).
 * Oura/Health Connect may still capture movement-based calories for those periods.
 *
 * This function:
 * 1. Reads the HC aggregate for the day
 * 2. Reads existing aurboda calorie points for the day
 * 3. Computes the residual (HC total - aurboda sum)
 * 4. Distributes it evenly across minutes without HR coverage
 * 5. Stores gap-fill points with source 'aurboda'
 */
export const gapFillCaloriesForDay = async (user: string, dayStartUtc: Date): Promise<GapFillDayResult> => {
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000 - 1)

  // 1. Get HC aggregate for this day (stored at midnight UTC with source 'health_connect_aggregate')
  const hcData = await getTimeSeriesBySource(
    user,
    'calories_active',
    'health_connect_aggregate',
    dayStartUtc,
    dayEndUtc,
  )
  if (hcData.length === 0) return { gap_minutes: 0, points_stored: 0, residual_kcal: 0 }

  const hcAggregateKcal = hcData.reduce((sum, [, value]) => sum + value, 0)

  // 2. Get existing aurboda calorie points for this day
  const existingData = await getTimeSeriesBySource(user, 'calories_active', 'aurboda', dayStartUtc, dayEndUtc)
  const aurbodaPoints: CalorieDataPoint[] = existingData.map(([time, value]) => ({
    end_time: new Date(time.getTime() + 60_000),
    kcal: value,
    time,
  }))

  // 3. Compute gap-fill points
  const result = computeGapFillPoints({
    aurboda_points: aurbodaPoints,
    day_start: dayStartUtc,
    hc_aggregate_kcal: hcAggregateKcal,
  })

  if (result.points.length === 0) return { gap_minutes: 0, points_stored: 0, residual_kcal: 0 }

  // 4. Store gap-fill points as aurboda source
  const timeSeriesPoints: TimeSeriesPoint[] = result.points.map((p) => ({
    metric: 'calories_active',
    source: 'aurboda' as const,
    time: p.time,
    unit: 'kcal',
    value: p.kcal,
  }))
  await insertTimeSeries(user, timeSeriesPoints)

  // 5. Invalidate training load impulse buckets for this day
  await invalidateTrainingLoadImpulses(user, dayStartUtc)

  return {
    gap_minutes: result.gap_minutes,
    points_stored: result.points.length,
    residual_kcal: result.residual_kcal,
  }
}

/**
 * Gap-fill calories for all calendar days within a time range.
 * Iterates day by day (UTC) and runs gap-fill for each.
 */
export const gapFillCaloriesForRange = async (
  user: string,
  start: Date,
  end: Date,
): Promise<{
  days_processed: number
  total_gap_minutes: number
  total_points_stored: number
  total_residual_kcal: number
}> => {
  // Align to UTC day boundaries
  const dayMs = 24 * 60 * 60 * 1000
  const firstDay = new Date(Math.floor(start.getTime() / dayMs) * dayMs)
  const lastDay = new Date(Math.floor(end.getTime() / dayMs) * dayMs)

  let daysProcessed = 0
  let totalGapMinutes = 0
  let totalPointsStored = 0
  let totalResidualKcal = 0

  for (let dayStart = firstDay.getTime(); dayStart <= lastDay.getTime(); dayStart += dayMs) {
    const result = await gapFillCaloriesForDay(user, new Date(dayStart))
    if (result.points_stored > 0) {
      daysProcessed++
      totalGapMinutes += result.gap_minutes
      totalPointsStored += result.points_stored
      totalResidualKcal += result.residual_kcal
    }
  }

  return {
    days_processed: daysProcessed,
    total_gap_minutes: totalGapMinutes,
    total_points_stored: totalPointsStored,
    total_residual_kcal: totalResidualKcal,
  }
}

/**
 * Recompute all calories_active data from scratch using the full HR data range.
 * Processes in daily chunks to avoid memory issues. Deletes existing aurboda
 * calorie data for each chunk before recomputing.
 */
export const computeAndStoreCaloriesAll = async (
  user: string,
): Promise<CalorieComputationResult & { days_processed: number }> => {
  const range = await getMetricTimeRange(user, 'heart_rate')
  if (!range) {
    return {
      days_processed: 0,
      points_computed: 0,
      points_stored: 0,
      skipped_reason: 'no HR data found',
      vo2_max_source: 'fallback',
    }
  }

  let totalComputed = 0
  let totalStored = 0
  let daysProcessed = 0
  let vo2MaxSource: 'measured' | 'fallback' = 'fallback'

  // Process in daily chunks
  const dayMs = 24 * 60 * 60 * 1000
  let chunkStart = new Date(range.min)

  while (chunkStart < range.max) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + dayMs, range.max.getTime() + 60_000))
    const result = await computeAndStoreCalories(user, chunkStart, chunkEnd, { force: true })

    totalComputed += result.points_computed
    totalStored += result.points_stored
    if (result.vo2_max_source === 'measured') vo2MaxSource = 'measured'
    daysProcessed++

    chunkStart = chunkEnd
  }

  // Gap-fill from HC aggregate data for minutes without HR coverage
  const gapFill = await gapFillCaloriesForRange(user, range.min, range.max)
  totalStored += gapFill.total_points_stored

  console.log(
    `🔥 Full recompute: ${totalStored} calorie points across ${daysProcessed} days for ${user}` +
      (gapFill.total_points_stored > 0 ?
        ` (${gapFill.total_points_stored} gap-filled from HC aggregate)`
      : ''),
  )

  return {
    days_processed: daysProcessed,
    points_computed: totalComputed,
    points_stored: totalStored,
    vo2_max_source: vo2MaxSource,
  }
}

/**
 * Trigger calorie computation for a time range after HR data ingestion.
 * This is a best-effort operation that never throws.
 * Also runs gap-filling to distribute HC aggregate residual into uncovered minutes.
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
    // Gap-fill from HC aggregate for days in the range
    const gapFill = await gapFillCaloriesForRange(user, start, end)
    if (gapFill.total_points_stored > 0) {
      console.log(
        `🔥 Gap-filled ${gapFill.total_points_stored} calorie points for ${user} ` +
          `(${gapFill.total_residual_kcal.toFixed(0)} kcal residual across ${gapFill.days_processed} days)`,
      )
    }
  } catch (err) {
    console.error('Calorie computation failed (non-fatal):', err)
  }
}
