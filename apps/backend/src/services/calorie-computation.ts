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

import type { BiologicalSex } from '@aurboda/api-spec'

import type { TimeSeriesPoint, UserSettings } from '../db/types.ts'

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
import { calculateDefaultHrZones, getSettings } from './settings.ts'

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

/** Default resting HR (bpm) when the user has no resting_heart_rate metric. */
const DEFAULT_RESTING_HR = 60

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
 * Resolve the zone-METs context for a user from already-loaded settings.
 * Picks the most-recent observed HR max (settings.training_load.observed_hr_max)
 * with a 220-age fallback. Defers to `getEffectiveHrZones` for the
 * custom → age-based → default zones priority, then applies one more
 * post-hoc fallback if the resolved zones look unusable for this user
 * (e.g. zone-1 start at or below resting HR).
 */
const resolveZoneMetsContext = (settings: UserSettings, age: number, restingHr: number): ZoneMetsContext => {
  const observedMax = settings.training_load?.observed_hr_max ?? 220 - age
  // Mirror getEffectiveHrZones' priority without going back to the DB:
  // custom (settings.hr_zone_start) → age-based (from birth_date) → default.
  let zones = settings.hr_zone_start ?? calculateDefaultHrZones(settings.birth_date ?? null)
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
 * Compute and store calories for the local day(s) overlapping a time range.
 *
 * Because `calories_total` is sourced exclusively from aurboda per-minute
 * data (no fallback to HC/Garmin daily aggregates), the BMR/min floor must
 * cover every minute of every affected day — otherwise incremental HR
 * ingestion would leave most of the day empty. This function therefore
 * always expands the caller-provided [start, end) to full local-day
 * boundaries before fetching HR / writing rows.
 *
 * Per affected day: HR-covered minutes get METs-scaled `calories_total`
 * and `calories_active`; uncovered minutes get a BMR/min floor for
 * `calories_total` (and no `calories_active` row).
 *
 * Idempotent: each call deletes any prior aurboda rows in the expanded
 * range before writing. Subsequent ingestion windows that touch the same
 * day re-write the day from scratch — safe under upsert semantics.
 */
export const computeAndStoreCalories = async (
  user: string,
  start: Date,
  end: Date,
  options?: { skipSync?: boolean },
): Promise<CalorieComputationResult> => {
  // 1. Settings + required fields (loaded once, threaded through helpers)
  const settings = await getUserSettings(user)
  if (!settings) return skippedResult('no settings')

  const sex = settings.sex as BiologicalSex | undefined
  if (!sex) return skippedResult('sex not set')
  if (!settings.birth_date) return skippedResult('birth_date not set')
  const age = calculateAge(settings.birth_date)
  const timezone = settings.device_timezone

  // 2. Expand to local-day boundaries so the BMR/min floor covers full days,
  //    not just the caller's HR-ingest window.
  const expandedStart = getLocalDayStart(start, timezone)
  // end is treated as exclusive; bump just past the last touched minute,
  // then snap to next local midnight (DST-safe via getLocalDayStart on +26h).
  const lastTouched = new Date(Math.max(end.getTime() - 1, start.getTime()))
  const lastDayStart = getLocalDayStart(lastTouched, timezone)
  const expandedEnd = getLocalDayStart(new Date(lastDayStart.getTime() + 26 * 60 * 60 * 1000), timezone)

  // 3. Weight + height for BMR fallback
  const weight = await getLatestMetricValue(user, 'weight', expandedEnd)
  if (weight === null) return skippedResult('no weight data')
  // The `height` metric is stored in metres (canonical unit 'm'); Mifflin-St Jeor
  // needs centimetres, so convert before passing it in.
  const heightMeters = await getLatestMetricValue(user, 'height', expandedEnd, 3650)
  const heightCm = heightMeters !== null ? heightMeters * 100 : null

  // 4. BMR (lab metric → Mifflin-St Jeor fallback)
  const bmr = await resolveBmr(user, expandedEnd, { age, height_cm: heightCm, sex, weight_kg: weight })
  if (bmr === null) return skippedResult('no BMR and no height for fallback')
  const bmrPerMin = bmr.value / 1440

  // 5. Resting HR + zone-METs context
  const restingHrMetric = await getLatestMetricValue(user, 'resting_heart_rate', expandedEnd)
  const restingHr = restingHrMetric ?? DEFAULT_RESTING_HR
  const zoneCtx = resolveZoneMetsContext(settings, age, restingHr)

  // 6. HR data for the full expanded range
  const hrData = await getTimeSeries(user, 'heart_rate', expandedStart, expandedEnd)

  // 7. Always wipe any prior aurboda rows for the expanded range so this run
  //    becomes the new ground truth. (No 'force' option needed — every call
  //    is authoritative for the day(s) it touches.)
  await deleteTimeSeriesBySource(user, 'calories_active', 'aurboda', expandedStart, expandedEnd)
  await deleteTimeSeriesBySource(user, 'calories_active', 'aurboda_gap_fill', expandedStart, expandedEnd)
  await deleteTimeSeriesBySource(user, 'calories_total', 'aurboda', expandedStart, expandedEnd)

  // 8. HR-derived per-minute zone-METs points (empty array is fine — every
  //    minute still gets a BMR/min floor in step 9).
  const allHrPoints =
    hrData.length === 0
      ? []
      : computeCaloriesPerMinuteZoneMets({
          bmr_kcal_per_day: bmr.value,
          hr_samples: hrData,
          zone_context: zoneCtx,
        })

  // The hold-forward loop can extend up to MAX_HOLD_MINUTES-1 past the last
  // HR sample's minute — those tail buckets may land outside the expanded
  // local-day range. Clamp before writing/queueing so DB rows and outbound
  // sync entries stay in lock-step.
  const hrPoints = allHrPoints.filter(
    (p) => p.time.getTime() >= expandedStart.getTime() && p.time.getTime() < expandedEnd.getTime(),
  )

  // 9. Build full-day points for the expanded range (BMR floor for non-HR mins)
  const { total, active } = buildFullDayPoints(
    expandedStart.getTime(),
    expandedEnd.getTime(),
    bmrPerMin,
    hrPoints,
  )

  // 10. Insert
  await insertTimeSeries(user, [...total, ...active])

  // 11. Queue outbound sync of active calories (HR-covered minutes only)
  if (!options?.skipSync) {
    await enqueueCalorieSync(user, hrPoints)
  }

  // 12. Invalidate training load impulses from the expanded start
  await invalidateTrainingLoadImpulses(user, expandedStart)

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

  let totalComputed = 0
  let totalStored = 0
  let daysProcessed = 0
  let bmrSource: 'lab' | 'mifflin_st_jeor' = 'mifflin_st_jeor'

  // Walk local-midnight day boundaries from min..max. Re-anchor each
  // iteration via getLocalDayStart so DST transitions (23h / 25h days)
  // stay aligned to local midnight rather than drifting by an hour for
  // every chunk after the first DST event.
  let chunkStart = getLocalDayStart(range.min, timezone)
  const lastDay = getLocalDayStart(range.max, timezone)

  while (chunkStart.getTime() <= lastDay.getTime()) {
    // Snap to next local midnight; +26h buffer handles spring-forward (23h
    // days). getLocalDayStart truncates back to the local midnight, so a
    // 23h or 25h day is handled correctly.
    const nextChunkStart = getLocalDayStart(new Date(chunkStart.getTime() + 26 * 60 * 60 * 1000), timezone)
    const result = await computeAndStoreCalories(user, chunkStart, nextChunkStart, {
      skipSync: true,
    })

    totalComputed += result.points_computed
    totalStored += result.points_stored
    if (result.bmr_source === 'lab') bmrSource = 'lab'
    daysProcessed++

    chunkStart = nextChunkStart
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
    const result = await computeAndStoreCalories(user, start, end)
    if (result.points_stored > 0) {
      auditInfo(user, 'data', `Computed ${result.points_stored} calorie points`, {
        bmr_source: result.bmr_source,
      })
    }
  } catch (err) {
    auditError(user, 'data', 'Calorie computation failed', { error: String(err) })
  }
}
