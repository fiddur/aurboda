/**
 * Health Connect data processing and daily aggregates.
 */
import { type DataSource, getExerciseTypeName, type MetricType } from '@aurboda/api-spec'

import type { Activity, DailyAggregate, MealFoodItem, RawRecord, TimeSeriesPoint } from './types.ts'

import {
  cumulativeMetrics,
  cumulativeSources,
  healthConnectActivityMapping,
  healthConnectMetricMapping,
  isValidMetric,
  metricUnits,
} from '../schema.ts'
/** Exercise type codes that remain as generic 'exercise' (UNKNOWN=0, OTHER_WORKOUT=2). */
const GENERIC_EXERCISE_CODES = new Set([0, 2])

/**
 * Resolve the activity_type for an ExerciseSessionRecord.
 * Maps the HC exerciseType integer to a specific type name (e.g., 'yoga', 'running').
 * Falls back to 'exercise' for unknown/other_workout types.
 */
const resolveExerciseActivityType = (data: Record<string, unknown>): string => {
  const exerciseType = data.exerciseType as number | undefined
  if (exerciseType === undefined || GENERIC_EXERCISE_CODES.has(exerciseType)) return 'exercise'
  return getExerciseTypeName(exerciseType) ?? 'exercise'
}

/**
 * Strip the HC exerciseType / exerciseTypeName keys before persisting to
 * activities.data — activity_type now carries that information, so keeping
 * them duplicates state and pollutes the daily-summary `data` passthrough.
 * The raw HC record (preserved in raw_records) still holds the originals.
 */
const stripExerciseTypeFromData = (data: Record<string, unknown>): Record<string, unknown> => {
  if (!('exerciseType' in data) && !('exerciseTypeName' in data)) return data
  const { exerciseType: _et, exerciseTypeName: _etn, ...rest } = data
  return rest
}

import { insertActivities, insertActivity } from './activities/index.ts'
import { query } from './connection.ts'
import { insertMeal } from './meals.ts'
import { insertRawRecord, insertRawRecords } from './raw-records.ts'
import { insertTimeSeries } from './time-series.ts'

/**
 * Process incoming Health Connect data and normalize into appropriate tables.
 */
export const processHealthConnectData = async (
  user: string,
  recordType: string,
  data: Record<string, unknown>,
) => {
  const externalId = (data.metadata as Record<string, unknown>)?.id as string | undefined

  // Always store raw record
  await insertRawRecord(user, {
    data,
    external_id: externalId,
    record_type: recordType,
    recorded_at: new Date((data.startTime || data.time) as string),
    source: 'health_connect',
  })

  // Normalize to time_series if applicable
  const metric = healthConnectMetricMapping[recordType]
  if (metric) {
    const points = extractTimeSeriesPoints(recordType, metric, data)
    if (points.length > 0) {
      await insertTimeSeries(user, points)
    }
  }

  // Handle blood pressure specially (two metrics)
  if (recordType === 'BloodPressureRecord') {
    const time = new Date((data.time as string) || (data.startTime as string))
    await insertTimeSeries(user, [
      {
        metric: 'blood_pressure_systolic',
        source: 'health_connect',
        time,
        value: data.systolicInMmHg as number,
      },
      {
        metric: 'blood_pressure_diastolic',
        source: 'health_connect',
        time,
        value: data.diastolicInMmHg as number,
      },
    ])
  }

  // Normalize NutritionRecord to meals
  if (recordType === 'NutritionRecord') {
    await processNutritionRecord(user, data)
  }

  // Normalize to activities if applicable
  const baseActivityType = healthConnectActivityMapping[recordType]
  if (baseActivityType) {
    // For exercise sessions, resolve the specific exercise type (yoga, running, etc.)
    const activityType =
      baseActivityType === 'exercise' ? resolveExerciseActivityType(data) : baseActivityType
    await insertActivity(user, {
      activity_type: activityType,
      data: stripExerciseTypeFromData(data),
      end_time: data.endTime ? new Date(data.endTime as string) : undefined,
      notes: data.notes as string | undefined,
      source: 'health_connect',
      start_time: new Date(data.startTime as string),
      title: data.title as string | undefined,
    })
  }
}

/**
 * Process a batch of Health Connect records efficiently using bulk inserts.
 *
 * Instead of inserting each record individually (2 queries per record),
 * this collects all raw records, time series points, and activities across
 * the batch and inserts each category in a single query.
 *
 * Meals (NutritionRecord) are still inserted individually since they're rare
 * and don't support upsert.
 */
export const processHealthConnectBatch = async (
  user: string,
  recordType: string,
  records: Record<string, unknown>[],
) => {
  if (records.length === 0) return

  // Collect all inserts across the batch
  const rawRecords: RawRecord[] = []
  const allTimeSeriesPoints: TimeSeriesPoint[] = []
  const activities: Activity[] = []
  const mealRecords: Record<string, unknown>[] = []

  for (const data of records) {
    const externalId = (data.metadata as Record<string, unknown>)?.id as string | undefined

    rawRecords.push({
      data,
      external_id: externalId,
      record_type: recordType,
      recorded_at: new Date((data.startTime || data.time) as string),
      source: 'health_connect',
    })

    // Collect time_series points
    const metric = healthConnectMetricMapping[recordType]
    if (metric) {
      const points = extractTimeSeriesPoints(recordType, metric, data)
      allTimeSeriesPoints.push(...points)
    }

    // Collect blood pressure points
    if (recordType === 'BloodPressureRecord') {
      const time = new Date((data.time as string) || (data.startTime as string))
      allTimeSeriesPoints.push(
        {
          metric: 'blood_pressure_systolic',
          source: 'health_connect',
          time,
          value: data.systolicInMmHg as number,
        },
        {
          metric: 'blood_pressure_diastolic',
          source: 'health_connect',
          time,
          value: data.diastolicInMmHg as number,
        },
      )
    }

    // Collect meals for individual insertion
    if (recordType === 'NutritionRecord') {
      mealRecords.push(data)
    }

    // Collect activities
    const baseActivityType = healthConnectActivityMapping[recordType]
    if (baseActivityType) {
      // For exercise sessions, resolve the specific exercise type (yoga, running, etc.)
      const resolvedType =
        baseActivityType === 'exercise' ? resolveExerciseActivityType(data) : baseActivityType
      activities.push({
        activity_type: resolvedType,
        data: stripExerciseTypeFromData(data),
        end_time: data.endTime ? new Date(data.endTime as string) : undefined,
        notes: data.notes as string | undefined,
        source: 'health_connect',
        start_time: new Date(data.startTime as string),
        title: data.title as string | undefined,
      })
    }
  }

  // Bulk insert all collected data (one query per category)
  await insertRawRecords(user, rawRecords)

  if (allTimeSeriesPoints.length > 0) {
    await insertTimeSeries(user, allTimeSeriesPoints)
  }

  if (activities.length > 0) {
    await insertActivities(user, activities)
  }

  // Meals don't have upsert logic and are rare -- insert individually
  for (const data of mealRecords) {
    await processNutritionRecord(user, data)
  }
}

/**
 * Extract time series points from Health Connect record.
 */
// eslint-disable-next-line complexity -- TODO: refactor
function extractTimeSeriesPoints(
  recordType: string,
  metric: MetricType,
  data: Record<string, unknown>,
): TimeSeriesPoint[] {
  // Records with samples (HeartRateRecord, SpeedRecord, PowerRecord, etc.)
  if (data.samples && Array.isArray(data.samples)) {
    const sampleValueField: Record<string, string> = {
      HeartRateRecord: 'beatsPerMinute',
      SpeedRecord: 'speedInMetersPerSecond',
      PowerRecord: 'powerInWatts',
    }
    const field = sampleValueField[recordType]
    if (!field) return []

    return (data.samples as { time: string; [key: string]: unknown }[]).map((sample) => ({
      metric,
      source: 'health_connect' as DataSource,
      time: new Date(sample.time),
      value: (sample[field] as number) || 0,
    }))
  }

  // Instant records (WeightRecord, BodyFatRecord, etc.)
  const time = data.time || data.startTime
  if (!time) return []

  let value: number | undefined

  switch (recordType) {
    case 'WeightRecord':
      value = data.weightInKilograms as number
      break
    case 'BodyFatRecord':
      value = data.percentage as number
      break
    case 'BoneMassRecord':
    case 'LeanBodyMassRecord':
    case 'BodyWaterMassRecord':
      value = data.massInKilograms as number
      break
    case 'HeightRecord':
      value = data.heightInMeters as number
      break
    case 'StepsRecord':
      value = data.count as number
      break
    case 'DistanceRecord':
      value = data.distanceInMeters as number
      break
    case 'FloorsClimbedRecord':
      value = data.floors as number
      break
    case 'ActiveCaloriesBurnedRecord':
    case 'TotalCaloriesBurnedRecord':
      value = data.energyInKilocalories as number
      break
    case 'BasalMetabolicRateRecord':
      value = data.basalMetabolicRateInKcalPerDay as number
      break
    case 'OxygenSaturationRecord':
      value = data.percentage as number
      break
    case 'RespiratoryRateRecord':
      value = data.rate as number
      break
    case 'BodyTemperatureRecord':
    case 'BasalBodyTemperatureRecord':
      value = data.temperatureInCelsius as number
      break
    case 'BloodGlucoseRecord':
      value = data.levelInMmolPerL as number
      break
    case 'Vo2MaxRecord':
      value = data.vo2MillilitersPerMinuteKilogram as number
      break
    case 'RestingHeartRateRecord':
      value = data.beatsPerMinute as number
      break
    case 'HeartRateVariabilityRmssdRecord':
      // Accept both field names for backwards compatibility with stored raw_records
      value = (data.heartRateVariabilityMillis ?? data.hrvInMilliseconds) as number
      break
    default:
      return []
  }

  if (value === undefined) return []

  return [
    {
      metric,
      source: 'health_connect' as DataSource,
      time: new Date(time as string),
      value,
    },
  ]
}

// ============================================================================
// NutritionRecord -> Meals
// ============================================================================

/**
 * Map Health Connect meal type enum to a readable string.
 * See: https://developer.android.com/reference/kotlin/androidx/health/connect/client/records/MealType
 */
const HC_MEAL_TYPES: Record<number, string> = {
  1: 'breakfast',
  2: 'lunch',
  3: 'dinner',
  4: 'snack',
}

/**
 * Process a Health Connect NutritionRecord into our meals table.
 */
const processNutritionRecord = async (user: string, data: Record<string, unknown>) => {
  const startTime = data.startTime as string | undefined
  const mealType = data.mealType as number | undefined
  const name = data.name as string | undefined

  await insertMeal(user, {
    calories: data.energyInKilocalories as number | undefined,
    carbs: data.totalCarbohydrateInGrams as number | undefined,
    fat: data.totalFatInGrams as number | undefined,
    fiber: data.dietaryFiberInGrams as number | undefined,
    food_items: data.foodItems ? (data.foodItems as MealFoodItem[]) : undefined,
    meal_type: mealType ? HC_MEAL_TYPES[mealType] : undefined,
    name,
    protein: data.proteinInGrams as number | undefined,
    source: 'health_connect',
    time: new Date(startTime ?? (data.time as string)),
  })
}

// ============================================================================
// Health Connect Record Deletion
// ============================================================================

/**
 * Delete Health Connect records by their external IDs.
 *
 * Removes the raw_record and cleans up corresponding time_series and activity entries.
 * Only deletes time_series entries with source='health_connect' (preserves aggregates).
 *
 * @returns Number of raw records actually deleted.
 */
export const deleteHealthConnectRecords = async (user: string, externalIds: string[]): Promise<number> => {
  // Batch-delete all raw records in one query, returning their data for cleanup
  const result = await query(
    user,
    `DELETE FROM raw_records
     WHERE source = 'health_connect' AND external_id = ANY($1)
     RETURNING record_type, data`,
    [externalIds],
  )

  const deleted = result.rows.length
  if (deleted === 0) return 0

  // Collect cleanup targets from the deleted records
  const timeSeriesDeletes: { time: Date; metric: string }[] = []
  const activityDeletes: { activityType: string; startTime: Date }[] = []

  for (const row of result.rows as { record_type: string; data: Record<string, unknown> }[]) {
    const { record_type: recordType, data } = row

    // Collect time_series entries to clean up
    const metric = healthConnectMetricMapping[recordType]
    if (metric) {
      const points = extractTimeSeriesPoints(recordType, metric, data)
      for (const point of points) {
        timeSeriesDeletes.push({ metric: point.metric, time: point.time })
      }
    }

    // Collect blood pressure entries (two metrics per record)
    if (recordType === 'BloodPressureRecord') {
      const time = new Date((data.time as string) || (data.startTime as string))
      timeSeriesDeletes.push({ metric: 'blood_pressure_systolic', time })
      timeSeriesDeletes.push({ metric: 'blood_pressure_diastolic', time })
    }

    // Collect activity entries to clean up
    const activityType = healthConnectActivityMapping[recordType]
    if (activityType && data.startTime) {
      activityDeletes.push({ activityType, startTime: new Date(data.startTime as string) })
    }
  }

  // Batch-delete time_series entries using VALUES list
  if (timeSeriesDeletes.length > 0) {
    const params: unknown[] = []
    const conditions = timeSeriesDeletes.map((d, i) => {
      params.push(d.time, d.metric)
      return `($${i * 2 + 1}::timestamptz, $${i * 2 + 2}::text)`
    })
    await query(
      user,
      `DELETE FROM time_series
       WHERE source = 'health_connect'
         AND (time, metric) IN (VALUES ${conditions.join(', ')})`,
      params,
    )
  }

  // Batch-delete activity entries using VALUES list
  if (activityDeletes.length > 0) {
    const params: unknown[] = []
    const conditions = activityDeletes.map((d, i) => {
      params.push(d.activityType, d.startTime)
      return `($${i * 2 + 1}::text, $${i * 2 + 2}::timestamptz)`
    })
    await query(
      user,
      `DELETE FROM activities
       WHERE source = 'health_connect'
         AND (activity_type, start_time) IN (VALUES ${conditions.join(', ')})`,
      params,
    )
  }

  return deleted
}

// ============================================================================
// Daily Aggregates (Deduplicated cumulative metrics from Health Connect)
// ============================================================================

/**
 * Convert a date string (YYYY-MM-DD) to midnight in the given IANA timezone, returned as UTC.
 * E.g., "2026-03-18" + "Europe/Stockholm" (CET, UTC+1) → 2026-03-17T23:00:00Z
 *
 * Falls back to UTC midnight if timezone is invalid or missing.
 */
export const localMidnightToUtc = (dateStr: string, timezone?: string): Date => {
  if (!timezone) {
    const time = new Date(dateStr)
    time.setUTCHours(0, 0, 0, 0)
    return time
  }

  try {
    // Parse the date components to avoid Date constructor timezone ambiguity
    const [y, m, d] = dateStr.split('-').map(Number)

    // Use Intl.DateTimeFormat to find the UTC offset for this date in this timezone.
    // Create a UTC date at midnight, then find what UTC time corresponds to local midnight.
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })

    // Binary-search approach: start from UTC midnight of the target date,
    // then adjust based on the timezone offset.
    // A simpler approach: construct a date string with timezone and parse it.
    const utcGuess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))

    // Get what local time this UTC time corresponds to
    const parts = formatter.formatToParts(utcGuess)
    const localHour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
    const localDay = Number(parts.find((p) => p.type === 'day')?.value ?? d)
    const localMonth = Number(parts.find((p) => p.type === 'month')?.value ?? m)

    // Calculate offset: if UTC midnight shows as local 01:00 on same day, offset is +1h
    // So local midnight is 1 hour before UTC midnight → UTC 23:00 previous day
    let offsetMs: number
    if (localDay === d && localMonth === m) {
      // Same day: offset in hours is localHour
      offsetMs = localHour * 60 * 60 * 1000
    } else if (localDay > d || localMonth > m) {
      // Crossed to next day: offset is positive and large (e.g., UTC+12)
      offsetMs = localHour * 60 * 60 * 1000 + 24 * 60 * 60 * 1000
    } else {
      // Crossed to previous day: offset is negative (e.g., UTC-12)
      offsetMs = (localHour - 24) * 60 * 60 * 1000
    }

    // Local midnight = UTC midnight - offset
    return new Date(utcGuess.getTime() - offsetMs)
  } catch {
    // Invalid timezone: fall back to UTC midnight
    const time = new Date(dateStr)
    time.setUTCHours(0, 0, 0, 0)
    return time
  }
}

/**
 * Process a daily aggregate from Health Connect.
 * Stores deduplicated daily totals for cumulative metrics.
 *
 * When timezone is provided, the aggregate is stored at local midnight
 * converted to UTC, ensuring correct day alignment for gap-fill.
 */
export const processDailyAggregate = async (
  user: string,
  aggregate: DailyAggregate & { timezone?: string },
): Promise<string | undefined> => {
  if (!isValidMetric(aggregate.metric)) {
    console.warn(`Invalid metric in daily aggregate: ${aggregate.metric}`)
    return
  }

  const metric = aggregate.metric as MetricType
  if (!cumulativeMetrics.includes(metric)) {
    console.warn(`Metric ${metric} is not a cumulative metric, skipping aggregate`)
    return
  }

  // Convert date to local midnight in the device's timezone (or UTC midnight if no timezone)
  const time = localMidnightToUtc(aggregate.date, aggregate.timezone)

  await query(
    user,
    `INSERT INTO time_series (time, metric, value, unit, source)
     VALUES ($1, $2, $3, $4, 'health_connect_aggregate')
     ON CONFLICT (time, metric, source) DO UPDATE SET value = EXCLUDED.value`,
    [time, metric, aggregate.value, metricUnits[metric]],
  )

  return aggregate.timezone
}

/**
 * Get the aggregate value for a cumulative metric on a specific day.
 * Returns null if no aggregate exists.
 */
export const getDailyAggregateValue = async (
  user: string,
  metric: MetricType,
  date: Date,
): Promise<number | null> => {
  const start = new Date(date)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(date)
  end.setUTCHours(23, 59, 59, 999)

  const result = await query(
    user,
    `SELECT value FROM time_series
     WHERE metric = $1 AND source = ANY($4)
     AND time >= $2 AND time < $3
     ORDER BY value DESC
     LIMIT 1`,
    [metric, start, end, cumulativeSources],
  )

  if (result.rows.length === 0) return null
  return result.rows[0].value
}
