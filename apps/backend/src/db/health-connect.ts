/**
 * Health Connect data processing and daily aggregates.
 */
import type { DataSource, MetricType } from '@aurboda/api-spec'
import {
  cumulativeMetrics,
  healthConnectActivityMapping,
  healthConnectMetricMapping,
  isValidMetric,
  metricUnits,
} from '../schema'
import { insertActivity } from './activities'
import { query } from './connection'
import { insertRawRecord } from './raw-records'
import { insertTimeSeries } from './time-series'
import type { DailyAggregate, TimeSeriesPoint } from './types'

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
 * Extract time series points from Health Connect record.
 */
// eslint-disable-next-line max-lines-per-function, complexity -- TODO: refactor
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
     WHERE metric = $1 AND source = 'health_connect_aggregate'
     AND time >= $2 AND time < $3
     LIMIT 1`,
    [metric, start, end],
  )

  if (result.rows.length === 0) return null
  return result.rows[0].value
}
