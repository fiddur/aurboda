/**
 * Service for automatic calorie computation from HR data.
 *
 * Triggered after HR data is ingested (from Health Connect, Oura, Garmin).
 * Computes per-minute calories using the zone-METs model (calibrated HR zones
 * + lab/Mifflin-St Jeor BMR) and stores both `calories_active` and
 * `calories_total` with source 'aurboda'. Outbound sync is queued so the
 * mobile app can write `calories_active` back to Health Connect.
 *
 * For minutes without HR coverage in a covered day, a BMR/min floor point is
 * written so the daily sum naturally equals BMR + active.
 */

import type { BiologicalSex, HrZoneThresholds } from '@aurboda/api-spec'

import type { TimeSeriesPoint } from '../db/types.ts'

import { localMidnightToUtc } from '../db/health-connect.ts'
import { enqueueOutboundSync, getUserSettings, upsertUserSettings } from '../db/index.ts'
import {
  deleteTimeSeriesBySource,
  getMetricTimeRange,
  getTimeSeries,
  insertTimeSeries,
} from '../db/time-series.ts'
import { isHealthConnectSyncableMetric, metricToHealthConnectType } from '../schema.ts'
import { auditError, auditInfo } from './audit-log.ts'
import {
  computeCaloriesPerMinuteZoneMets,
  defaultHrZoneThresholds,
  estimateBmrMifflinStJeor,
  type ZoneMetsCaloriePoint,
  type ZoneMetsContext,
} from './calories.ts'
import { getEffectiveHrZones, getSettings } from './settings.ts'

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

/**
 * Queue outbound sync entries for active-calorie data points (best-effort).
 *
 * When `skipSync` is true (used during full historical recomputes), no entries
 * are queued to avoid flooding the outbound queue with thousands of old data
 * points that would starve more important entries (exercises, weight, etc.).
 *
 * For normal incremental computation (triggered by new HR data), all new
 * calorie points are queued regardless of their timestamp.
 */
export const enqueueCalorieSync = async (
  user: string,
  points: { time: Date; end_time: Date; kcal_active: number }[],
): Promise<void> => {
  try {
    if (points.length === 0) return
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
          value: p.kcal_active,
        },
      })
    }
  } catch (err) {
    auditError(user, 'data', 'Failed to enqueue calorie outbound sync', { error: String(err) })
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
      training_load: {
        ...settings.training_load,
        impulse_watermark: effectiveTime.toISOString(),
      },
    })
  } catch (err) {
    auditError(user, 'data', 'Failed to invalidate training load impulses', { error: String(err) })
  }
}

const skippedResult = (
  reason: string,
  bmrSource: 'lab' | 'mifflin_st_jeor' = 'mifflin_st_jeor',
): CalorieComputationResult => ({
  bmr_source: bmrSource,
  points_computed: 0,
  points_stored: 0,
  skipped_reason: reason,
})

export interface CalorieComputationResult {
  points_computed: number
  points_stored: number
  bmr_source: 'lab' | 'mifflin_st_jeor'
  skipped_reason?: string
}

/**
 * Resolve the BMR (kcal/day) to use for calorie computation.
 *
 * Priority: latest `basal_metabolic_rate` metric (e.g. InBody lab measurement,
 * looked back up to 2 years) → Mifflin-St Jeor fallback from weight/height/age/sex.
 * Returns null if no usable inputs are available.
 */
const resolveBmr = async (
  user: string,
  beforeTime: Date,
  inputs: {
    sex: BiologicalSex
    age: number
    weight_kg: number
    height_cm: number | null
  },
): Promise<{ value: number; source: 'lab' | 'mifflin_st_jeor' } | null> => {
  const labBmr = await getLatestMetricValue(user, 'basal_metabolic_rate', beforeTime, 730)
  if (labBmr !== null && labBmr > 0) return { source: 'lab', value: labBmr }
  if (inputs.height_cm === null || inputs.height_cm <= 0) return null
  return {
    source: 'mifflin_st_jeor',
    value: estimateBmrMifflinStJeor(inputs.weight_kg, inputs.height_cm, inputs.age, inputs.sex),
  }
}

/**
 * Resolve the zone-METs context for a user at a given point in time.
 * Picks the most-recent observed HR max (settings.training_load.observed_hr_max)
 * with a 220-age fallback. Falls back to derived zones if user has none set.
 */
const resolveZoneMetsContext = async (
  user: string,
  beforeTime: Date,
  age: number,
  restingHr: number,
): Promise<ZoneMetsContext> => {
  const settings = await getSettings(user)
  const observedMax = settings.training_load?.observed_hr_max ?? 220 - age
  let zones: HrZoneThresholds
  if (settings.hr_zone_start) {
    zones = settings.hr_zone_start
  } else {
    const effective = await getEffectiveHrZones(user)
    zones = effective.zones
  }
  // If zones look unusable (e.g. min < resting), fall back to HRR-derived.
  if (zones[1] <= restingHr) zones = defaultHrZoneThresholds(restingHr, observedMax)
  return { observed_hr_max: observedMax, resting_hr: restingHr, zones }
}

/**
 * Build per-minute time_series points covering every minute in [dayStart, dayEnd)
 * for `calories_total` (BMR-floored) and `calories_active`, merging HR-derived
 * points where present and BMR/min floors for uncovered minutes.
 */
const buildFullDayPoints = (
  dayStartMs: number,
  dayEndMs: number,
  bmrPerMin: number,
  hrPoints: ZoneMetsCaloriePoint[],
): { total: TimeSeriesPoint[]; active: TimeSeriesPoint[] } => {
  const hrByMinute = new Map<number, ZoneMetsCaloriePoint>()
  for (const p of hrPoints) hrByMinute.set(Math.floor(p.time.getTime() / 60_000), p)

  const total: TimeSeriesPoint[] = []
  const active: TimeSeriesPoint[] = []
  for (let ms = dayStartMs; ms < dayEndMs; ms += 60_000) {
    const minuteKey = Math.floor(ms / 60_000)
    const p = hrByMinute.get(minuteKey)
    const totalKcal = p?.kcal_total ?? bmrPerMin
    const activeKcal = p?.kcal_active ?? 0
    const time = new Date(ms)
    total.push({ metric: 'calories_total', source: 'aurboda', time, unit: 'kcal', value: totalKcal })
    if (activeKcal > 0) {
      active.push({ metric: 'calories_active', source: 'aurboda', time, unit: 'kcal', value: activeKcal })
    }
  }
  return { active, total }
}

/**
 * Compute and store calories for a time range where HR data exists.
 *
 * Uses the zone-METs model and writes per-minute `calories_total` and
 * `calories_active` (source 'aurboda') for every minute in the affected
 * day(s). HR-covered minutes get METs-scaled values; uncovered minutes get
 * a BMR/min floor for `calories_total` (and 0 for `calories_active`).
 */
export const computeAndStoreCalories = async (
  user: string,
  start: Date,
  end: Date,
  options?: { force?: boolean; skipSync?: boolean },
): Promise<CalorieComputationResult> => {
  // 1. Settings + required fields
  const settings = await getUserSettings(user)
  if (!settings) return skippedResult('no settings')

  const sex = settings.sex as BiologicalSex | undefined
  if (!sex) return skippedResult('sex not set')
  if (!settings.birth_date) return skippedResult('birth_date not set')
  const age = calculateAge(settings.birth_date)

  // 2. Weight + height for BMR fallback
  const weight = await getLatestMetricValue(user, 'weight', end)
  if (weight === null) return skippedResult('no weight data')
  const height = await getLatestMetricValue(user, 'height', end, 3650)

  // 3. BMR (lab metric → Mifflin-St Jeor fallback)
  const bmr = await resolveBmr(user, end, { age, height_cm: height, sex, weight_kg: weight })
  if (bmr === null) return skippedResult('no BMR and no height for fallback')
  const bmrPerMin = bmr.value / 1440

  // 4. Resting HR + zone-METs context
  const restingHrMetric = await getLatestMetricValue(user, 'resting_heart_rate', end)
  const restingHr = restingHrMetric ?? 60
  const zoneCtx = await resolveZoneMetsContext(user, end, age, restingHr)

  // 5. HR data for the range
  const hrData = await getTimeSeries(user, 'heart_rate', start, end)
  if (hrData.length === 0) return skippedResult('no HR data', bmr.source)

  // 6. Force-recompute: delete all existing aurboda calorie rows in range
  if (options?.force) {
    await deleteTimeSeriesBySource(user, 'calories_active', 'aurboda', start, end)
    await deleteTimeSeriesBySource(user, 'calories_active', 'aurboda_gap_fill', start, end)
    await deleteTimeSeriesBySource(user, 'calories_total', 'aurboda', start, end)
  }

  // 7. HR-derived per-minute zone-METs points
  const hrPoints = computeCaloriesPerMinuteZoneMets({
    bmr_kcal_per_day: bmr.value,
    hr_samples: hrData,
    zone_context: zoneCtx,
  })

  if (hrPoints.length === 0) {
    return { bmr_source: bmr.source, points_computed: 0, points_stored: 0, skipped_reason: 'no HR coverage' }
  }

  // 8. Expand to full minutes for the affected range, BMR-floor for non-HR minutes.
  //    Anchor to whole minutes from start..end (caller controls range; typically a day).
  const rangeStartMs = Math.floor(start.getTime() / 60_000) * 60_000
  const rangeEndMs = Math.ceil(end.getTime() / 60_000) * 60_000
  const { total, active } = buildFullDayPoints(rangeStartMs, rangeEndMs, bmrPerMin, hrPoints)

  // 9. Insert
  await insertTimeSeries(user, [...total, ...active])

  // 10. Queue outbound sync of active calories (HR-covered minutes only)
  if (!options?.skipSync) {
    await enqueueCalorieSync(user, hrPoints)
  }

  // 11. Invalidate training load impulses
  await invalidateTrainingLoadImpulses(user, start)

  return {
    bmr_source: bmr.source,
    points_computed: hrPoints.length,
    points_stored: total.length + active.length,
  }
}

/**
 * Get the user's device timezone from settings, or undefined if not set.
 * Used by full-recompute to align day boundaries to local midnight.
 */
const getDeviceTimezone = async (user: string): Promise<string | undefined> => {
  const settings = await getUserSettings(user)
  return (settings?.device_timezone as string) ?? undefined
}

const getLocalDayStart = (utcTime: Date, timezone?: string): Date => {
  if (!timezone) {
    const dayMs = 24 * 60 * 60 * 1000
    return new Date(Math.floor(utcTime.getTime() / dayMs) * dayMs)
  }
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  })
  const localDateStr = formatter.format(utcTime)
  return localMidnightToUtc(localDateStr, timezone)
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
      bmr_source: 'mifflin_st_jeor',
      days_processed: 0,
      points_computed: 0,
      points_stored: 0,
      skipped_reason: 'no HR data found',
    }
  }

  const timezone = await getDeviceTimezone(user)
  const dayMs = 24 * 60 * 60 * 1000

  let totalComputed = 0
  let totalStored = 0
  let daysProcessed = 0
  let bmrSource: 'lab' | 'mifflin_st_jeor' = 'mifflin_st_jeor'

  // Walk local-midnight day boundaries from min..max so BMR-floor coverage
  // aligns to the user's calendar days.
  let chunkStart = getLocalDayStart(range.min, timezone)
  const lastDay = getLocalDayStart(range.max, timezone)

  while (chunkStart.getTime() <= lastDay.getTime()) {
    const chunkEnd = new Date(chunkStart.getTime() + dayMs)
    const result = await computeAndStoreCalories(user, chunkStart, chunkEnd, {
      force: true,
      skipSync: true,
    })

    totalComputed += result.points_computed
    totalStored += result.points_stored
    if (result.bmr_source === 'lab') bmrSource = 'lab'
    daysProcessed++

    chunkStart = chunkEnd
  }

  auditInfo(user, 'data', `Full calorie recompute: ${totalStored} points across ${daysProcessed} days`, {
    bmr_source: bmrSource,
  })

  return {
    bmr_source: bmrSource,
    days_processed: daysProcessed,
    points_computed: totalComputed,
    points_stored: totalStored,
  }
}

/**
 * Trigger calorie computation for a time range after HR data ingestion.
 * Best-effort, never throws.
 */
export const triggerCalorieComputation = async (user: string, start: Date, end: Date): Promise<void> => {
  try {
    const result = await computeAndStoreCalories(user, start, end, { force: true })
    if (result.points_stored > 0) {
      auditInfo(user, 'data', `Computed ${result.points_stored} calorie points`, {
        bmr_source: result.bmr_source,
      })
    }
  } catch (err) {
    auditError(user, 'data', 'Calorie computation failed', { error: String(err) })
  }
}
