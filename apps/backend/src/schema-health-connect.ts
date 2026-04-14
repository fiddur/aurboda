/**
 * Health Connect data type mappings.
 *
 * Maps between Health Connect record types and Aurboda metric/activity types
 * in both directions (inbound sync and outbound sync).
 */

import type { ActivityType, MetricType } from '@aurboda/api-spec'

import { exerciseTypeNames } from '@aurboda/api-spec'

// ============================================================================
// Inbound mappings: Health Connect -> Aurboda
// ============================================================================

/**
 * Mapping from Health Connect record types to our metric types.
 */
export const healthConnectMetricMapping: Record<string, MetricType | null> = {
  ActiveCaloriesBurnedRecord: 'calories_active',
  BasalBodyTemperatureRecord: 'basal_body_temperature',
  BasalMetabolicRateRecord: 'calories_basal',
  BloodGlucoseRecord: 'blood_glucose',
  BloodPressureRecord: null, // Handled specially (two metrics)
  BodyFatRecord: 'body_fat',
  BodyTemperatureRecord: 'body_temperature',
  BodyWaterMassRecord: 'body_water_mass',
  BoneMassRecord: 'bone_mass',
  DistanceRecord: 'distance',
  FloorsClimbedRecord: 'floors_climbed',
  HeartRateRecord: 'heart_rate',
  HeartRateVariabilityRmssdRecord: 'hrv_rmssd',
  HeightRecord: 'height',
  LeanBodyMassRecord: 'lean_body_mass',
  OxygenSaturationRecord: 'spo2',
  RespiratoryRateRecord: 'respiratory_rate',
  RestingHeartRateRecord: 'resting_heart_rate',
  StepsRecord: 'steps',
  TotalCaloriesBurnedRecord: 'calories_total',
  Vo2MaxRecord: 'vo2_max',
  WeightRecord: 'weight',
  SpeedRecord: 'speed',
  PowerRecord: 'power',
}

/**
 * Health Connect record types that map to activities.
 */
export const healthConnectActivityMapping: Record<string, ActivityType | null> = {
  ExerciseSessionRecord: 'exercise',
  SleepSessionRecord: 'sleep',
}

// ============================================================================
// Reverse mappings: Aurboda data -> Health Connect record types
// Used for outbound sync (writing Aurboda data to Health Connect)
// ============================================================================

/**
 * Mapping from Aurboda metric types to Health Connect record type names.
 * Only metrics that have a direct HC equivalent are included.
 */
export const metricToHealthConnectType: Partial<Record<MetricType, string>> = {
  body_fat: 'BodyFatRecord',
  body_water_mass: 'BodyWaterMassRecord',
  bone_mass: 'BoneMassRecord',
  calories_active: 'ActiveCaloriesBurnedRecord',
  heart_rate: 'HeartRateRecord',
  height: 'HeightRecord',
  hrv_rmssd: 'HeartRateVariabilityRmssdRecord',
  lean_body_mass: 'LeanBodyMassRecord',
  resting_heart_rate: 'RestingHeartRateRecord',
  steps: 'StepsRecord',
  weight: 'WeightRecord',
}

/**
 * Mapping from Aurboda activity types to Health Connect record type names.
 * Includes all exercise types (they all map to ExerciseSessionRecord) plus sleep types.
 * Note: The canonical source for HC mappings is the activity_type_definitions table.
 * This static map is a fallback for when the DB isn't available.
 */
export const activityTypeToHealthConnectType: Record<string, string> = {
  exercise: 'ExerciseSessionRecord',
  nap: 'SleepSessionRecord',
  sleep: 'SleepSessionRecord',
  // All exercise subtypes also map to ExerciseSessionRecord
  ...Object.fromEntries(exerciseTypeNames.map((name) => [name, 'ExerciseSessionRecord'])),
}

/**
 * Check if a metric type can be synced to Health Connect.
 */
export const isHealthConnectSyncableMetric = (metric: string): boolean => metric in metricToHealthConnectType

/**
 * Check if an activity type can be synced to Health Connect.
 */
export const isHealthConnectSyncableActivity = (activityType: string): boolean =>
  activityType in activityTypeToHealthConnectType
