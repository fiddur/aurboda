import { builtinDashboardMetrics } from '@aurboda/api-spec'

/**
 * Friendly display names for built-in metrics.
 */
export const metricLabels: Record<string, string> = {
  body_fat: 'Body Fat',
  calories_active: 'Active Calories',
  calories_basal: 'Basal Calories',
  calories_total: 'Total Calories',
  distance: 'Distance',
  floors_climbed: 'Floors Climbed',
  heart_rate: 'Heart Rate',
  hr_zone_0_sec: 'Zone 0 (Below Z1)',
  hr_zone_1_sec: 'Zone 1',
  hr_zone_2_sec: 'Zone 2',
  hr_zone_3_sec: 'Zone 3',
  hr_zone_4_sec: 'Zone 4',
  hr_zone_5_sec: 'Zone 5',
  hrv_7day: 'HRV (7-day)',
  hrv_30day: 'HRV (30-day)',
  hrv_rmssd: 'HRV (RMSSD)',
  readiness_score: 'Readiness Score',
  resilience_score: 'Resilience Score',
  resting_heart_rate: 'Resting HR',
  rhr_7day: 'Resting HR (7-day)',
  rhr_30day: 'Resting HR (30-day)',
  sleep_score: 'Sleep Score',
  spo2: 'SpO2',
  steps: 'Steps',
  vo2_max: 'VO2 Max',
  weight: 'Weight',
  zone2_weekly: 'Zone 2 (Weekly)',
}

/**
 * Get a display name for any metric, falling back to the raw name.
 */
export const getMetricDisplayName = (metric: string): string => metricLabels[metric] ?? metric

/**
 * Built-in dashboard metrics with their display names.
 */
export const builtinDashboardMetricOptions = builtinDashboardMetrics.map((m) => ({
  label: metricLabels[m] ?? m,
  value: m,
}))
