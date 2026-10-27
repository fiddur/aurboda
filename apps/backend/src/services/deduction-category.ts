import type {
  ActivityFeatureCondition,
  ActivityFeatureName,
  ActivityFeatureOperator,
  ActivityFeatures,
  DeductionRule,
  RunCategory,
} from '@aurboda/api-spec'

const featureLabels: Record<ActivityFeatureName, string> = {
  duration_vs_median_90d: 'duration vs the 90-day median',
  elapsed_s: 'elapsed time',
  elevation_gain_m: 'elevation gain',
  elevation_oscillation: 'elevation oscillation',
  hr_drift_pct: 'HR drift',
  interval_count: 'intervals',
  low_hr_ceiling_bpm: 'low-HR ceiling',
  low_hr_fraction: 'time at or below the low-HR ceiling',
  moving_s: 'moving time',
  pace_cv: 'pace variability',
  rest_block_median_s: 'median rest block',
  work_block_cv: 'work block variability',
  work_block_median_s: 'median work block',
  work_rest_pace_ratio: 'work/rest pace ratio',
  zone0_fraction: 'time in zone 0',
  zone1_fraction: 'time in zone 1',
  zone2_fraction: 'time in zone 2',
  zone3_fraction: 'time in zone 3',
  zone4_fraction: 'time in zone 4',
  zone5_fraction: 'time in zone 5',
}

const operatorSymbols: Record<ActivityFeatureOperator, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' }

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)} s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  const minutes = Math.round(seconds / 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

const formatFeatureValue = (feature: ActivityFeatureName, value: number): string => {
  if (feature.endsWith('_fraction')) return `${Math.round(value * 100)}%`
  if (feature.endsWith('_s')) return formatDuration(value)
  switch (feature) {
    case 'interval_count':
      return String(Math.round(value))
    case 'low_hr_ceiling_bpm':
      return `${Math.round(value)} bpm`
    case 'elevation_gain_m':
      return `${Math.round(value)} m`
    case 'elevation_oscillation':
      return `${Math.round(value)} m/km`
    case 'hr_drift_pct':
      return `${value.toFixed(1)}%`
    default:
      return value.toFixed(2)
  }
}

const featureConditionsOf = (rule: Pick<DeductionRule, 'conditions'>): ActivityFeatureCondition[] =>
  rule.conditions.filter((c): c is ActivityFeatureCondition => c.kind === 'activity_feature')

/** One line per feature condition: the activity's value when known, then the comparison. */
export const categoryReasons = (
  rule: Pick<DeductionRule, 'conditions'>,
  features: ActivityFeatures | null,
): string[] =>
  featureConditionsOf(rule).map(({ feature, operator, value }) => {
    const actual = features?.[feature]
    const comparison = `${operatorSymbols[operator]} ${formatFeatureValue(feature, value)}`
    return typeof actual === 'number'
      ? `${featureLabels[feature]} ${formatFeatureValue(feature, actual)} ${comparison}`
      : `${featureLabels[feature]} ${comparison}`
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const sameEntry = (a: unknown, b: RunCategory): boolean =>
  isRecord(a) &&
  a.category === b.category &&
  a.rule_id === b.rule_id &&
  Array.isArray(a.reasons) &&
  a.reasons.length === b.reasons.length &&
  a.reasons.every((reason, i) => reason === b.reasons[i])

/**
 * The `run_categories` patch for one activity, or null when it would not change. Only the
 * rule's own entry (by rule_id) is added, updated in place or removed; manual entries and
 * other rules' entries are kept as they are, and a category in `run_categories_excluded`
 * is never added.
 */
export const applyCategory = (
  data: Record<string, unknown>,
  rule: Pick<DeductionRule, 'id' | 'output_category'>,
  wanted: boolean,
  reasons: string[],
): { run_categories: unknown[] } | null => {
  const category = rule.output_category
  if (!category) return null
  const current: unknown[] = Array.isArray(data.run_categories) ? data.run_categories : []
  const excluded = Array.isArray(data.run_categories_excluded) ? data.run_categories_excluded : []
  const entry: RunCategory | null =
    wanted && !excluded.includes(category) ? { category, reasons, rule_id: rule.id } : null

  const owned = (item: unknown) => isRecord(item) && item.rule_id === rule.id
  const firstOwned = current.findIndex(owned)
  const next = current.flatMap((item, i) => {
    if (!owned(item)) return [item]
    return i === firstOwned && entry ? [entry] : []
  })
  if (entry && firstOwned === -1) next.push(entry)

  const unchanged =
    next.length === current.length &&
    next.every(
      (item, i) => item === current[i] || (entry !== null && item === entry && sameEntry(current[i], entry)),
    )
  return unchanged ? null : { run_categories: next }
}
