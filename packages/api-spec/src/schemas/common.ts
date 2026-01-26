/**
 * Common schemas shared across the Aurboda API.
 *
 * Uses Zod 4's native .meta() for OpenAPI metadata.
 */

import { z } from 'zod'

/**
 * List of all valid metric types.
 */
export const validMetrics = [
  'heart_rate',
  'resting_heart_rate',
  'hrv_rmssd',
  'weight',
  'body_fat',
  'bone_mass',
  'lean_body_mass',
  'body_water_mass',
  'height',
  'steps',
  'distance',
  'floors_climbed',
  'calories_active',
  'calories_total',
  'calories_basal',
  'spo2',
  'respiratory_rate',
  'body_temperature',
  'basal_body_temperature',
  'blood_glucose',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'vo2_max',
  'readiness_score',
  'resilience_score',
  'productivity_score',
  'cardiovascular_age',
  'sleep_score',
  'sleep_efficiency',
  'sleep_latency',
  'sleep_restfulness',
  'sleep_timing',
  'sleep_deep_score',
  'sleep_rem_score',
  'sleep_total_score',
  'hr_zone_0_sec',
  'hr_zone_1_sec',
  'hr_zone_2_sec',
  'hr_zone_3_sec',
  'hr_zone_4_sec',
  'hr_zone_5_sec',
] as const

export const metricTypeSchema = z.enum(validMetrics).meta({
  description: 'Type of health metric',
  example: 'heart_rate',
  id: 'MetricType',
})

export type MetricType = z.infer<typeof metricTypeSchema>

/**
 * Check if a string is a valid metric type.
 */
export const isValidMetric = (metric: string): metric is MetricType =>
  (validMetrics as readonly string[]).includes(metric)

/**
 * HR zone metrics are computed from heart_rate data, not stored directly.
 */
export const hrZoneMetrics = [
  'hr_zone_0_sec',
  'hr_zone_1_sec',
  'hr_zone_2_sec',
  'hr_zone_3_sec',
  'hr_zone_4_sec',
  'hr_zone_5_sec',
] as const

/**
 * Check if a metric is an HR zone metric (computed, not stored).
 */
export const isHrZoneMetric = (metric: MetricType): boolean =>
  (hrZoneMetrics as readonly string[]).includes(metric)

/**
 * Activity types for activities table.
 */
export const activityTypeSchema = z.enum(['sleep', 'exercise', 'meditation', 'nap']).meta({
  description: 'Type of activity',
  example: 'exercise',
  id: 'ActivityType',
})

export type ActivityType = z.infer<typeof activityTypeSchema>

/**
 * Supported data sources.
 */
export const dataSourceSchema = z
  .enum(['health_connect', 'health_connect_aggregate', 'oura', 'garmin', 'rescuetime', 'owntracks', 'manual'])
  .meta({
    description: 'Source of the data',
    example: 'health_connect',
    id: 'DataSource',
  })

export type DataSource = z.infer<typeof dataSourceSchema>

/**
 * ISO 8601 date-time string schema.
 */
export const iso8601DateTimeSchema = z.iso.datetime().meta({
  description: 'ISO 8601 date-time string',
  example: '2024-01-15T14:30:00Z',
  id: 'ISO8601DateTime',
})

/**
 * Date-only string schema (YYYY-MM-DD).
 */
export const dateOnlySchema = z.iso.date().meta({
  description: 'Date in YYYY-MM-DD format',
  example: '2024-01-15',
  id: 'DateOnly',
})

/**
 * Unit definitions for metrics.
 */
export const metricUnits: Record<MetricType, string> = {
  basal_body_temperature: 'celsius',
  blood_glucose: 'mmol/L',
  blood_pressure_diastolic: 'mmHg',
  blood_pressure_systolic: 'mmHg',
  body_fat: 'percent',
  body_temperature: 'celsius',
  body_water_mass: 'kg',
  bone_mass: 'kg',
  calories_active: 'kcal',
  calories_basal: 'kcal',
  calories_total: 'kcal',
  cardiovascular_age: 'years',
  distance: 'm',
  floors_climbed: 'count',
  heart_rate: 'bpm',
  height: 'm',
  hr_zone_0_sec: 'sec',
  hr_zone_1_sec: 'sec',
  hr_zone_2_sec: 'sec',
  hr_zone_3_sec: 'sec',
  hr_zone_4_sec: 'sec',
  hr_zone_5_sec: 'sec',
  hrv_rmssd: 'ms',
  lean_body_mass: 'kg',
  productivity_score: 'score',
  readiness_score: 'score',
  resilience_score: 'score',
  respiratory_rate: 'brpm',
  resting_heart_rate: 'bpm',
  sleep_deep_score: 'score',
  sleep_efficiency: 'score',
  sleep_latency: 'score',
  sleep_rem_score: 'score',
  sleep_restfulness: 'score',
  sleep_score: 'score',
  sleep_timing: 'score',
  sleep_total_score: 'score',
  spo2: 'percent',
  steps: 'count',
  vo2_max: 'mL/kg/min',
  weight: 'kg',
}

/**
 * Cumulative metrics that are summed over a day and can have duplicate sources.
 */
export const cumulativeMetrics: MetricType[] = [
  'steps',
  'distance',
  'floors_climbed',
  'calories_active',
  'calories_total',
]

/**
 * Place visit source schema.
 */
export const placeSourceSchema = z.enum(['named', 'detected', 'owntracks', 'unknown']).meta({
  description: 'Source of place identification',
  example: 'named',
  id: 'PlaceSource',
})

export type PlaceSource = z.infer<typeof placeSourceSchema>

/**
 * Geocode status schema.
 */
export const geocodeStatusSchema = z.enum(['pending', 'geocoding', 'success', 'failed']).meta({
  description: 'Status of geocoding operation',
  example: 'success',
  id: 'GeocodeStatus',
})

export type GeocodeStatus = z.infer<typeof geocodeStatusSchema>

/**
 * HR zone source schema.
 */
export const hrZoneSourceSchema = z.enum(['custom', 'age_based', 'default']).meta({
  description: 'Source of HR zone thresholds',
  example: 'age_based',
  id: 'HrZoneSource',
})

export type HrZoneSource = z.infer<typeof hrZoneSourceSchema>

/**
 * Sync status schema.
 */
export const syncStatusSchema = z.enum(['idle', 'syncing', 'error']).meta({
  description: 'Status of sync operation',
  example: 'idle',
  id: 'SyncStatus',
})

export type SyncStatus = z.infer<typeof syncStatusSchema>
