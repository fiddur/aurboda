import type { ActivityFeatureName, ActivityFeatures } from '@aurboda/api-spec'

type Unit = 'percent' | 'fraction' | 'minutes' | 'seconds' | 'metres' | 'per_km' | 'bpm' | 'ratio' | 'count'

const FEATURES: [ActivityFeatureName, string, Unit][] = [
  ['elapsed_s', 'Elapsed', 'minutes'],
  ['moving_s', 'Moving', 'minutes'],
  ['duration_vs_median_90d', 'Duration vs 90-day median', 'ratio'],
  ['low_hr_fraction', 'Time at low HR', 'fraction'],
  ['low_hr_ceiling_bpm', 'Low-HR ceiling', 'bpm'],
  ['zone0_fraction', 'Zone 0', 'fraction'],
  ['zone1_fraction', 'Zone 1', 'fraction'],
  ['zone2_fraction', 'Zone 2', 'fraction'],
  ['zone3_fraction', 'Zone 3', 'fraction'],
  ['zone4_fraction', 'Zone 4', 'fraction'],
  ['zone5_fraction', 'Zone 5', 'fraction'],
  ['hr_drift_pct', 'HR drift', 'percent'],
  ['pace_cv', 'Pace variability', 'fraction'],
  ['interval_count', 'Intervals', 'count'],
  ['work_block_median_s', 'Work block (median)', 'seconds'],
  ['rest_block_median_s', 'Rest block (median)', 'seconds'],
  ['work_block_cv', 'Work block variability', 'fraction'],
  ['work_rest_pace_ratio', 'Rest ÷ work pace', 'ratio'],
  ['elevation_gain_m', 'Elevation gain', 'metres'],
  ['elevation_oscillation', 'Climb + descent', 'per_km'],
]

const formatValue = (value: number, unit: Unit): string => {
  switch (unit) {
    case 'fraction':
      return `${Math.round(value * 100)}%`
    case 'percent':
      return `${value.toFixed(1)}%`
    case 'minutes':
      return `${(value / 60).toFixed(1)} min`
    case 'seconds':
      return `${Math.round(value)} s`
    case 'metres':
      return `${Math.round(value)} m`
    case 'per_km':
      return `${value.toFixed(1)} m/km`
    case 'bpm':
      return `${Math.round(value)} bpm`
    case 'ratio':
      return `${value.toFixed(2)}×`
    case 'count':
      return String(Math.round(value))
  }
}

export const runFeatureRows = (
  features: ActivityFeatures | undefined,
): { key: ActivityFeatureName; label: string; value: string }[] =>
  features
    ? FEATURES.flatMap(([key, label, unit]) => {
        const value = features[key]
        return value === null || value === undefined ? [] : [{ key, label, value: formatValue(value, unit) }]
      })
    : []
