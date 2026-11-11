import type {
  AddAutoshareRuleBody,
  AutoshareDataFilter,
  AutoshareRule,
  FeedVisibility,
  MetricType,
  UpdateAutoshareRuleBody,
} from '@aurboda/api-spec'

import { DEFAULT_SUMMARY, SERIES_METRICS, SUMMARY_METRICS } from '../../components/feed-metrics'
import { formatTagsInput, parseTagsInput } from '../../components/hashtags'
import { type DataFilterRow, rowToDataFilter, ruleTagsText } from './autoshare-rule-text'

export const DEFAULT_MAX_AGE_HOURS = 24

export interface RuleFormState {
  activityType: string
  conditions: DataFilterRow[]
  includeExercises: boolean
  includeMap: boolean
  maxAgeHours: string
  message: string
  minKm: string
  minMinutes: string
  name: string
  ownTags: boolean
  series: Set<string>
  summary: Set<string>
  tagsText: string
  visibility: FeedVisibility
}

export const emptyRuleFormState = (): RuleFormState => ({
  activityType: '',
  conditions: [],
  includeExercises: false,
  includeMap: false,
  maxAgeHours: String(DEFAULT_MAX_AGE_HOURS),
  message: '',
  minKm: '',
  minMinutes: '',
  name: '',
  ownTags: false,
  series: new Set(),
  summary: new Set(DEFAULT_SUMMARY),
  tagsText: '',
  visibility: 'followers',
})

const formatDecimal = (value: number, digits: number): string => String(Number(value.toFixed(digits)))

export const dataFilterToRow = (filter: AutoshareDataFilter): DataFilterRow => ({
  field: filter.field,
  operator: filter.operator,
  value: filter.value === undefined ? '' : String(filter.value),
})

/** The rule picks a single type in the form; a rule with several types keeps them and the form leaves them be. */
export const ruleHasManyActivityTypes = (rule: AutoshareRule): boolean => rule.activity_types.length > 1

export const ruleToFormState = (rule: AutoshareRule): RuleFormState => {
  const series = new Set(rule.series_metrics)
  if (rule.include_chart) series.add('heart_rate')
  return {
    activityType: rule.activity_types.length === 1 ? (rule.activity_types[0] ?? '') : '',
    conditions: rule.data_filters.map(dataFilterToRow),
    includeExercises: rule.include_exercises,
    includeMap: rule.include_map,
    maxAgeHours: String(rule.max_age_hours),
    message: rule.message ?? '',
    minKm: rule.min_distance_meters ? formatDecimal(rule.min_distance_meters / 1000, 6) : '',
    minMinutes: rule.min_duration_seconds ? formatDecimal(rule.min_duration_seconds / 60, 2) : '',
    name: rule.name,
    ownTags: rule.tags !== null,
    series,
    summary: new Set(rule.included_metrics),
    tagsText: formatTagsInput(rule.tags ?? []),
    visibility: rule.visibility,
  }
}

const orderedPick = <T extends string>(known: readonly T[], picked: ReadonlySet<T>): T[] => [
  ...known.filter((key) => picked.has(key)),
  ...[...picked].filter((key) => !known.includes(key)),
]

const minutesToSeconds = (text: string): number | null => {
  if (text.trim() === '') return null
  const seconds = Math.round(Number(text) * 60)
  return seconds === 0 && Number(text) > 0 ? 1 : seconds
}

const kmToMeters = (text: string): number | null =>
  text.trim() === '' ? null : Math.round(Number(text) * 1_000_000) / 1000

const templateFields = (state: RuleFormState) => ({
  data_filters: state.conditions.map(rowToDataFilter),
  include_chart: state.series.has('heart_rate'),
  include_exercises: state.includeExercises,
  include_map: state.includeMap,
  included_metrics: orderedPick(
    SUMMARY_METRICS.map((m) => m.key),
    state.summary,
  ),
  max_age_hours: state.maxAgeHours.trim() === '' ? DEFAULT_MAX_AGE_HOURS : Number(state.maxAgeHours),
  name: state.name.trim() || 'Unnamed rule',
  // Stored keys outside the metric-type enum are sent back as they are, so an edit never drops one.
  series_metrics: orderedPick<string>(
    SERIES_METRICS.map((m) => m.key),
    state.series,
  ) as MetricType[],
  visibility: state.visibility,
})

/**
 * The add-shaped body: what a new rule is created with, and what the preview
 * counts. Given the rule being edited, the predicate fields the form does not
 * show (several activity types, max duration, source) come from it.
 */
export const formStateToAddBody = (state: RuleFormState, rule?: AutoshareRule): AddAutoshareRuleBody => {
  const message = state.message.trim()
  const minDistance = kmToMeters(state.minKm)
  const minDuration = minutesToSeconds(state.minMinutes)
  return {
    ...templateFields(state),
    activity_types:
      rule && ruleHasManyActivityTypes(rule)
        ? rule.activity_types
        : state.activityType
          ? [state.activityType]
          : [],
    ...(message === '' ? {} : { message }),
    ...(state.ownTags ? { tags: parseTagsInput(state.tagsText) } : {}),
    ...(minDistance === null ? {} : { min_distance_meters: minDistance }),
    ...(minDuration === null ? {} : { min_duration_seconds: minDuration }),
    ...(rule?.max_duration_seconds ? { max_duration_seconds: rule.max_duration_seconds } : {}),
    ...(rule?.source ? { source: rule.source } : {}),
  }
}

/**
 * The update body for an edited rule: a cleared field is sent as `null`, and
 * what the form does not expose (max duration, source, several activity types)
 * is not sent, so it stays as it was.
 */
export const formStateToUpdateBody = (state: RuleFormState, rule: AutoshareRule): UpdateAutoshareRuleBody => {
  const message = state.message.trim()
  return {
    ...templateFields(state),
    ...(ruleHasManyActivityTypes(rule)
      ? {}
      : { activity_types: state.activityType ? [state.activityType] : [] }),
    message: message === '' ? null : message,
    min_distance_meters: kmToMeters(state.minKm),
    min_duration_seconds: minutesToSeconds(state.minMinutes),
    tags: state.ownTags ? parseTagsInput(state.tagsText) : null,
  }
}

export const formStateTagsText = (state: RuleFormState): string =>
  ruleTagsText({ message: state.message, tags: state.ownTags ? parseTagsInput(state.tagsText) : null })
