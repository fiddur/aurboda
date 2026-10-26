import { type ActivityMeasure, activityMeasures, type ChartDataAggregation } from '@aurboda/api-spec'

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

export const measurePatch = (breakdown_fields: string[], measure: MeasureChoice) =>
  measure
    ? { aggregation: defaultAggregation(measure), chart_type: 'bar' as const, measure }
    : {
        aggregation: 'count' as const,
        breakdown_fields: breakdown_fields.filter((f) => !isItemPath(f)),
        filter_field: '',
        filter_value: '',
        measure: '' as const,
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
