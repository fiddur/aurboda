import {
  type ActivityMeasure,
  activityMeasures,
  type ChartDataAggregation,
  type DataSchemaDefinition,
  isSummedActivityMeasure,
  MUSCLE_GROUP_SUFFIX,
  muscleGroupBreakdownPath,
  muscleGroupFilter,
} from '@aurboda/api-spec'

import { categoricalItemFields, fieldLabel, itemPath } from '../../components/sessions/sessionView'
import { EMA_HALF_LIFE_DEFAULT, MEASURE_HALF_LIFE_DEFAULT } from '../../utils/half-life'

export { MEASURE_HALF_LIFE_DEFAULT }
import { defaultAggregation } from '../../utils/measures'

type SourceType = 'metric' | 'activity_type'

export type MeasureChoice = ActivityMeasure | ''

export interface MeasureState {
  filter_field: string
  filter_value: string
  measure: MeasureChoice
}

const isItemPath = (field: string): boolean => field.includes('.')

const isMuscleGroupPath = (field: string): boolean => muscleGroupBreakdownPath(field) !== undefined

const AGGREGATIONS: readonly string[] = ['count', 'sum', 'mean', 'max'] satisfies ChartDataAggregation[]

export const sourceDefaultAggregation = (source_type: SourceType): ChartDataAggregation =>
  source_type === 'metric' ? 'mean' : 'count'

export const parseMeasure = (raw: string | undefined, source_type: SourceType): MeasureChoice =>
  source_type === 'activity_type' &&
  raw !== undefined &&
  (activityMeasures as readonly string[]).includes(raw)
    ? (raw as ActivityMeasure)
    : ''

/** The measure of a chart URL with its item filter, which only applies with a measure. */
export const parseMeasureQuery = (
  query: Partial<Record<'filter_field' | 'filter_value' | 'measure', string>>,
  source_type: SourceType,
): MeasureState => {
  const measure = parseMeasure(query.measure, source_type)
  const filter = filterPatch(measure ? query.filter_field : undefined, query.filter_value ?? '')
  const invalidMuscleFilter =
    isMuscleGroupPath(filter.filter_field) &&
    (!isSummedActivityMeasure(measure) || !muscleGroupFilter(filter.filter_field, filter.filter_value))
  return { measure, ...(invalidMuscleFilter ? filterPatch(undefined, '') : filter) }
}

/** The muscle group a chart is filtered to: `{ path: 'sets.exercise', group: 'chest' }`. */
export const muscleFilterOf = (state: Pick<MeasureState, 'filter_field' | 'filter_value'>) =>
  muscleGroupFilter(state.filter_field || undefined, state.filter_value || undefined)

/**
 * The breakdowns a muscle filter on `path` allows: no muscle-group breakdown, and of item paths only
 * its own (one series per exercise).
 */
export const breakdownsWithMuscleFilter = (breakdown_fields: string[], path: string): string[] =>
  breakdown_fields.filter((f) => !isMuscleGroupPath(f) && (!isItemPath(f) || f === path))

/**
 * Filter to one muscle group of an item path, or with an empty group clear the filter. It replaces
 * any exercise filter, as a chart has one filter.
 */
export const muscleFilterPatch = (
  breakdown_fields: string[],
  path: string | undefined,
  group: string,
): Omit<MeasureState, 'measure'> & { breakdown_fields: string[] } =>
  path && group
    ? {
        breakdown_fields: breakdownsWithMuscleFilter(breakdown_fields, path),
        filter_field: `${path}${MUSCLE_GROUP_SUFFIX}`,
        filter_value: group,
      }
    : { breakdown_fields, ...filterPatch(undefined, '') }

/** A trend takes no muscle filter: switching to one drops it. */
export const trendFilterPatch = (
  state: Pick<MeasureState, 'filter_field' | 'filter_value'>,
): Partial<Omit<MeasureState, 'measure'>> => (muscleFilterOf(state) ? filterPatch(undefined, '') : {})

/** A parsed chart's measure and breakdowns made consistent: a trend drops a muscle filter, bars keep only the breakdowns it allows. */
export const withMuscleFilterRules = (
  state: MeasureState & { breakdown_fields: string[] },
  chart_type: string,
): MeasureState & { breakdown_fields: string[] } => {
  const muscle = muscleFilterOf(state)
  if (!muscle) return state
  if (chart_type === 'trend') return { ...state, ...filterPatch(undefined, '') }
  return { ...state, breakdown_fields: breakdownsWithMuscleFilter(state.breakdown_fields, muscle.path) }
}

/** The item path whose muscle groups a summed measure can be filtered to: the first categorical, catalogue-backed one. */
export const muscleFilterPath = (
  schema: DataSchemaDefinition | undefined,
  measure: MeasureChoice,
): string | undefined => {
  const first = isSummedActivityMeasure(measure) ? categoricalItemFields(schema)[0] : undefined
  return first?.item.catalog ? itemPath(first.list, first.item) : undefined
}

/** A measure is never counted, and only a measure has a max. */
export const parseAggregation = (
  raw: string | undefined,
  source_type: SourceType,
  measure: MeasureChoice,
): ChartDataAggregation => {
  const fallback = measure ? defaultAggregation(measure) : sourceDefaultAggregation(source_type)
  if (raw === undefined || !AGGREGATIONS.includes(raw)) return fallback
  if (measure ? raw === 'count' : raw === 'max') return fallback
  return raw as ChartDataAggregation
}

/**
 * A measure that is not summed drops a muscle-group breakdown and a muscle filter; no measure drops
 * every item path and filter.
 */
export const measurePatch = (breakdown_fields: string[], measure: MeasureChoice, filter_field = '') =>
  measure
    ? {
        aggregation: defaultAggregation(measure),
        chart_type: 'bar' as const,
        measure,
        ...(!isSummedActivityMeasure(measure) && breakdown_fields.some(isMuscleGroupPath)
          ? { breakdown_fields: breakdown_fields.filter((f) => !isMuscleGroupPath(f)) }
          : {}),
        ...(!isSummedActivityMeasure(measure) && isMuscleGroupPath(filter_field)
          ? filterPatch(undefined, '')
          : {}),
      }
    : {
        aggregation: 'count' as const,
        breakdown_fields: breakdown_fields.filter((f) => !isItemPath(f)),
        filter_field: '',
        filter_value: '',
        measure: '' as const,
      }

/**
 * The item-path breakdowns a measure offers: one series per value of the first categorical item
 * field, and with a summed measure and a catalogue-backed field one per muscle group.
 */
export const itemBreakdownOptions = (
  schema: DataSchemaDefinition | undefined,
  measure: MeasureChoice,
  filter: Pick<MeasureState, 'filter_field' | 'filter_value'> = { filter_field: '', filter_value: '' },
): { label: string; name: string }[] => {
  const first = measure ? categoricalItemFields(schema)[0] : undefined
  if (!first) return []
  const path = itemPath(first.list, first.item)
  const byValue = { label: fieldLabel(first.item), name: path }
  const muscle = muscleFilterOf(filter)
  if (muscle) return muscle.path === path ? [byValue] : []
  return first.item.catalog && isSummedActivityMeasure(measure)
    ? [byValue, { label: 'Muscle group', name: `${path}${MUSCLE_GROUP_SUFFIX}` }]
    : [byValue]
}

/** Toggle a breakdown field; a muscle-group breakdown and another item path exclude each other. */
export const toggleBreakdownField = (fields: string[], field: string): string[] => {
  if (fields.includes(field)) return fields.filter((f) => f !== field)
  if (isMuscleGroupPath(field)) return [...fields.filter((f) => !isItemPath(f)), field]
  if (isItemPath(field)) return [...fields.filter((f) => !isMuscleGroupPath(f)), field]
  return [...fields, field]
}

/** An empty value is the "All" choice. */
export const filterPatch = (path: string | undefined, value: string): Omit<MeasureState, 'measure'> =>
  path && value ? { filter_field: path, filter_value: value } : { filter_field: '', filter_value: '' }

/** The measure fields of a chart-data query, a bar widget config or a chart URL. */
export const measureParams = (
  state: MeasureState,
): { filter_field?: string; filter_value?: string; measure?: ActivityMeasure } =>
  state.measure
    ? {
        measure: state.measure,
        ...(state.filter_field && state.filter_value
          ? { filter_field: state.filter_field, filter_value: state.filter_value }
          : {}),
      }
    : {}

export const aggregationOptions = (
  source_type: SourceType,
  measure: MeasureChoice,
): { label: string; value: ChartDataAggregation }[] => {
  if (measure) {
    return [
      { label: 'Sum', value: 'sum' },
      { label: 'Max', value: 'max' },
      { label: 'Average', value: 'mean' },
    ]
  }
  if (source_type === 'metric') {
    return [
      { label: 'Average', value: 'mean' },
      { label: 'Sum', value: 'sum' },
      { label: 'Count', value: 'count' },
    ]
  }
  return [
    { label: 'Sum (hours)', value: 'sum' },
    { label: 'Count', value: 'count' },
  ]
}

export const EMA_HALF_LIFE_OPTIONS = [
  { label: '7 days (Quick)', value: 7 },
  { label: '15 days (Responsive)', value: 15 },
  { label: '30 days (Stable)', value: 30 },
]

export const MEASURE_HALF_LIFE_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '120 days', value: MEASURE_HALF_LIFE_DEFAULT },
  { label: '240 days', value: 240 },
  { label: '1 year', value: 365 },
]

/** A measure's decaying best moves slower than an EMA of a rate, so it takes longer half-lives. */
export const halfLifeOptions = (measure: MeasureChoice): { label: string; value: number }[] =>
  measure ? MEASURE_HALF_LIFE_OPTIONS : EMA_HALF_LIFE_OPTIONS

/** A measure charts as bars unless the URL asks for its trend, whose half-life defaults longer than an EMA's. */
export const parseChartMode = (
  query: Partial<Record<'chart_type' | 'half_life_days', string>>,
  measure: MeasureChoice,
): { chart_type: 'bar' | 'trend'; half_life_days: number } => {
  const chart_type = measure
    ? query.chart_type === 'trend'
      ? 'trend'
      : 'bar'
    : query.chart_type === 'bar'
      ? 'bar'
      : 'trend'
  const fallback = chart_type === 'trend' && measure ? MEASURE_HALF_LIFE_DEFAULT : EMA_HALF_LIFE_DEFAULT
  return { chart_type, half_life_days: Number(query.half_life_days) || fallback }
}
