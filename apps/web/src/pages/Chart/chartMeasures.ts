import {
  type ActivityMeasure,
  activityMeasures,
  type ChartDataAggregation,
  type DataSchemaDefinition,
  isSummedActivityMeasure,
  MUSCLE_GROUP_SUFFIX,
  muscleGroupBreakdownPath,
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
  return { measure, ...filterPatch(measure ? query.filter_field : undefined, query.filter_value ?? '') }
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

const isItemPath = (field: string): boolean => field.includes('.')

const isMuscleGroupPath = (field: string): boolean => muscleGroupBreakdownPath(field) !== undefined

/** A measure that is not summed drops a muscle-group breakdown; no measure drops every item path. */
export const measurePatch = (breakdown_fields: string[], measure: MeasureChoice) =>
  measure
    ? {
        aggregation: defaultAggregation(measure),
        chart_type: 'bar' as const,
        measure,
        ...(!isSummedActivityMeasure(measure) && breakdown_fields.some(isMuscleGroupPath)
          ? { breakdown_fields: breakdown_fields.filter((f) => !isMuscleGroupPath(f)) }
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
): { label: string; name: string }[] => {
  const first = measure ? categoricalItemFields(schema)[0] : undefined
  if (!first) return []
  const path = itemPath(first.list, first.item)
  const byValue = { label: fieldLabel(first.item), name: path }
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
