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
  'hrv_sleep',
  'hrv_activity',
  'hrv_awake',
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
  'training_impulse',
  'activity_impulse',
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
 * Contextual HRV metrics are computed by filtering hrv_rmssd data by context.
 * - hrv_sleep: HRV during sleep windows
 * - hrv_activity: HRV during exercise sessions
 * - hrv_awake: HRV when not sleeping or exercising
 */
export const contextualHrvMetrics = ['hrv_sleep', 'hrv_activity', 'hrv_awake'] as const

/**
 * Check if a metric is a contextual HRV metric (computed from hrv_rmssd).
 */
export const isContextualHrvMetric = (metric: MetricType): boolean =>
  (contextualHrvMetrics as readonly string[]).includes(metric)

/**
 * Valid activity types.
 */
export const activityTypes = ['sleep', 'exercise', 'meditation', 'nap', 'rest'] as const

/**
 * Activity types for activities table.
 */
export const activityTypeSchema = z.enum(activityTypes).meta({
  description: 'Type of activity',
  example: 'exercise',
  id: 'ActivityType',
})

export type ActivityType = z.infer<typeof activityTypeSchema>

/**
 * Supported data sources.
 */
export const dataSourceSchema = z
  .enum([
    'activitywatch',
    'aurboda',
    'health_connect',
    'health_connect_aggregate',
    'lab_report',
    'oura',
    'garmin',
    'rescuetime',
    'owntracks',
    'calendar',
    'manual',
    'lastfm',
    'lastfm-auto',
  ])
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
  activity_impulse: 'impulse',
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
  hrv_activity: 'ms',
  hrv_awake: 'ms',
  hrv_rmssd: 'ms',
  hrv_sleep: 'ms',
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
  training_impulse: 'TRIMP',
  vo2_max: 'mL/kg/min',
  weight: 'kg',
}

/**
 * Custom metric definition.
 * Users can define their own metric types with custom names and units.
 */
export const customMetricDefinitionSchema = z
  .object({
    description: z.string().optional().meta({ description: 'Human-readable description' }),
    max_value: z.number().optional().meta({ description: 'Maximum allowed value' }),
    min_value: z.number().optional().meta({ description: 'Minimum allowed value' }),
    name: z
      .string()
      .min(1)
      .max(50)
      .regex(
        /^[a-z][a-z0-9_]*$/,
        'Must be lowercase letters, numbers, and underscores, starting with a letter',
      )
      .meta({ description: 'Metric name (e.g., "mood", "caffeine_mg")', example: 'mood' }),
    unit: z
      .string()
      .min(1)
      .max(20)
      .meta({ description: 'Unit of measurement (e.g., "score", "mg")', example: 'score' }),
  })
  .meta({ id: 'CustomMetricDefinition' })

export type CustomMetricDefinition = z.infer<typeof customMetricDefinitionSchema>

/**
 * Validate a custom metric name doesn't conflict with built-in metrics.
 */
export const isValidCustomMetricName = (name: string): boolean =>
  /^[a-z][a-z0-9_]*$/.test(name) && name.length <= 50 && !isValidMetric(name)

/**
 * Get the unit for a metric, checking both built-in and custom metrics.
 * Returns undefined if the metric is not found in either.
 */
export const getMetricUnit = (
  metric: string,
  customMetrics: CustomMetricDefinition[] = [],
): string | undefined => {
  if (isValidMetric(metric)) return metricUnits[metric]
  return customMetrics.find((m) => m.name === metric)?.unit
}

/**
 * Check if a string is a valid metric (built-in or custom).
 */
export const isValidMetricOrCustom = (
  metric: string,
  customMetrics: CustomMetricDefinition[] = [],
): boolean => isValidMetric(metric) || customMetrics.some((m) => m.name === metric)

/**
 * Aggregation type for metrics: 'sum' for cumulative totals, 'avg' for instantaneous values.
 * Determines how values are combined in time buckets.
 */
export type MetricAggregation = 'avg' | 'sum'

/**
 * Metrics that should be summed when bucketed (cumulative totals).
 * All other metrics default to averaging.
 */
export const sumMetrics: MetricType[] = [
  'steps',
  'distance',
  'floors_climbed',
  'calories_active',
  'calories_total',
  'calories_basal',
  'hr_zone_0_sec',
  'hr_zone_1_sec',
  'hr_zone_2_sec',
  'hr_zone_3_sec',
  'hr_zone_4_sec',
  'hr_zone_5_sec',
  'training_impulse',
  'activity_impulse',
]

/** Get the aggregation type for a metric (sum or avg). */
export const getMetricAggregation = (metric: string): MetricAggregation =>
  (sumMetrics as string[]).includes(metric) ? 'sum' : 'avg'

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
 * Trusted sources for cumulative metrics.
 * health_connect_aggregate: deduplicated daily totals from Health Connect
 * aurboda: computed values (e.g., calorie calculation from HR data)
 */
export const cumulativeSources: DataSource[] = ['health_connect_aggregate', 'aurboda']

/**
 * Metrics where 'aurboda' per-minute data should be used exclusively
 * instead of mixing with 'health_connect_aggregate' daily totals.
 *
 * When aurboda computes per-minute values (e.g., calories from HR data),
 * the daily aggregate from Health Connect is redundant and would produce
 * nonsense if AVG'd with per-minute values in the same bucket.
 */
export const aurbodaOnlyMetrics: MetricType[] = ['calories_active']

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

// ============================================================================
// Reusable Field Schemas
// ============================================================================

/**
 * Geocoded address field.
 * Use addressNullableSchema when geocoding might have been attempted but returned no result.
 */
export const addressSchema = z.string().meta({ description: 'Geocoded address' })
export const addressNullableSchema = z.string().nullable().meta({ description: 'Geocoded address' })

/**
 * Latitude field without range validation.
 * Use for response schemas where data is already validated.
 * @see latWithValidationSchema for input validation with -90 to 90 range check
 */
export const latSchema = z.number().meta({ description: 'Latitude', example: 59.3293 })

/**
 * Latitude field with -90 to 90 range validation.
 * Use for request/input schemas where user-provided data needs validation.
 * @see latSchema for response schemas without validation
 */
export const latWithValidationSchema = z.number().min(-90).max(90).meta({ description: 'Latitude' })

/**
 * Longitude field without range validation.
 * Use for response schemas where data is already validated.
 * @see lonWithValidationSchema for input validation with -180 to 180 range check
 */
export const lonSchema = z.number().meta({ description: 'Longitude', example: 18.0686 })

/**
 * Longitude field with -180 to 180 range validation.
 * Use for request/input schemas where user-provided data needs validation.
 * @see lonSchema for response schemas without validation
 */
export const lonWithValidationSchema = z.number().min(-180).max(180).meta({ description: 'Longitude' })

/**
 * Tag/label text field.
 */
export const tagTextSchema = z.string().meta({ description: 'Tag/label text', example: 'coffee' })

/**
 * Detected location ID field (UUID reference to a detected location).
 */
export const detectedLocationIdSchema = z.string().uuid().meta({
  description: 'ID of detected location if source is detected',
})

/**
 * Radius in meters field.
 */
export const radiusSchema = z.number().int().meta({ description: 'Radius in meters', example: 200 })

/**
 * Duration in minutes field.
 */
export const durationMinutesSchema = z.number().meta({ description: 'Duration in minutes' })

/**
 * Common start/end date-time query fields.
 */
export const startDateTimeQuerySchema = iso8601DateTimeSchema.meta({ description: 'Start date/time' })
export const endDateTimeQuerySchema = iso8601DateTimeSchema.meta({ description: 'End date/time' })

/**
 * Standard time range query schema - reusable for any query that needs start/end.
 */
export const timeRangeQuerySchema = z.object({
  end: endDateTimeQuerySchema,
  start: startDateTimeQuerySchema,
})

/**
 * Success response field.
 */
export const successSchema = z.boolean()

/**
 * Error message field.
 */
export const errorSchema = z.string().optional()

/**
 * Base response schema with success and optional error.
 */
export const baseResponseSchema = z.object({
  error: errorSchema,
  success: successSchema,
})

/**
 * Create a data response schema wrapping an array of items.
 */
export const createDataArrayResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  baseResponseSchema.extend({
    data: z.array(itemSchema).optional(),
  })

/**
 * Create a data response schema wrapping a single item.
 */
export const createDataResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  baseResponseSchema.extend({
    data: itemSchema.optional(),
  })
