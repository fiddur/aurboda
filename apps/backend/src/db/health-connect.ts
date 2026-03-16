/**
 * Health Connect data processing and daily aggregates.
 */
import type { DataSource, MetricType } from '@aurboda/api-spec'
import {
  cumulativeMetrics,
  cumulativeSources,
  healthConnectActivityMapping,
  healthConnectMetricMapping,
  isValidMetric,
  metricUnits,
} from '../schema'
import { insertActivities, insertActivity } from './activities'
import { query } from './connection'
import { insertMeal } from './meals'
import { insertRawRecord, insertRawRecords } from './raw-records'
import { insertTimeSeries } from './time-series'
import type { Activity, DailyAggregate, MealFoodItem, RawRecord, TimeSeriesPoint } from './types'

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
  const activityType = healthConnectActivityMapping[recordType]
  if (activityType) {
    await insertActivity(user, {
      activity_type: activityType,
      data,
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
    const activityType = healthConnectActivityMapping[recordType]
    if (activityType) {
      activities.push({
        activity_type: activityType,
        data,
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
  // Records with samples (HeartRateRecord, etc.)
  if (data.samples && Array.isArray(data.samples)) {
    return (data.samples as { time: string; beatsPerMinute?: number }[]).map((sample) => ({
      metric,
      source: 'health_connect' as DataSource,
      time: new Date(sample.time),
      value: sample.beatsPerMinute || 0,
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
  let deleted = 0

  for (const externalId of externalIds) {
    // Delete raw record and return its data for cleanup
    const result = await query(
      user,
      `DELETE FROM raw_records
       WHERE source = 'health_connect' AND external_id = $1
       RETURNING record_type, data`,
      [externalId],
    )

    if (result.rows.length === 0) continue
    deleted++

    const { record_type: recordType, data } = result.rows[0] as {
      record_type: string
      data: Record<string, unknown>
    }

    // Clean up time_series entries
    const metric = healthConnectMetricMapping[recordType]
    if (metric) {
      const points = extractTimeSeriesPoints(recordType, metric, data)
      for (const point of points) {
        await query(
          user,
          `DELETE FROM time_series WHERE time = $1 AND metric = $2 AND source = 'health_connect'`,
          [point.time, point.metric],
        )
      }
    }

    // Clean up blood pressure entries (two metrics)
    if (recordType === 'BloodPressureRecord') {
      const time = new Date((data.time as string) || (data.startTime as string))
      await query(
        user,
        `DELETE FROM time_series
         WHERE time = $1 AND metric IN ('blood_pressure_systolic', 'blood_pressure_diastolic')
           AND source = 'health_connect'`,
        [time],
      )
    }

    // Clean up activity entries
    const activityType = healthConnectActivityMapping[recordType]
    if (activityType && data.startTime) {
      await query(
        user,
        `DELETE FROM activities
         WHERE source = 'health_connect' AND activity_type = $1 AND start_time = $2`,
        [activityType, new Date(data.startTime as string)],
      )
    }
  }

  return deleted
}

// ============================================================================
// Daily Aggregates (Deduplicated cumulative metrics from Health Connect)
// ============================================================================

/**
 * Process a daily aggregate from Health Connect.
 * Stores deduplicated daily totals for cumulative metrics.
 */
export const processDailyAggregate = async (user: string, aggregate: DailyAggregate) => {
  if (!isValidMetric(aggregate.metric)) {
    console.warn(`Invalid metric in daily aggregate: ${aggregate.metric}`)
    return
  }

  const metric = aggregate.metric as MetricType
  if (!cumulativeMetrics.includes(metric)) {
    console.warn(`Metric ${metric} is not a cumulative metric, skipping aggregate`)
    return
  }

  // Parse the date and set to midnight UTC
  const time = new Date(aggregate.date)
  time.setUTCHours(0, 0, 0, 0)

  await query(
    user,
    `INSERT INTO time_series (time, metric, value, unit, source)
     VALUES ($1, $2, $3, $4, 'health_connect_aggregate')
     ON CONFLICT (time, metric, source) DO UPDATE SET value = EXCLUDED.value`,
    [time, metric, aggregate.value, metricUnits[metric]],
  )
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
     LIMIT 1`,
    [metric, start, end, cumulativeSources],
  )

  if (result.rows.length === 0) return null
  return result.rows[0].value
}
