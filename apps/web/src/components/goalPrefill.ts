import {
  type ActivityMeasure,
  activityMeasures,
  type Goal,
  type TrendDisplayPeriod,
  type TrendGoal,
  type TrendSourceType,
} from '@aurboda/api-spec'

import { EMA_HALF_LIFE_DEFAULT, MEASURE_HALF_LIFE_DEFAULT } from '../utils/half-life'
import { defaultAggregation } from '../utils/measures'

type TrendAggregation = NonNullable<TrendGoal['aggregation']>

interface ItemFilter {
  filter_field?: string
  filter_value?: string
}

export type GoalPrefill =
  | ({
      new: 'trend'
      source_type: TrendSourceType
      pattern: string
      half_life_days?: number
      display_period?: TrendDisplayPeriod
      aggregation?: TrendAggregation
      measure?: ActivityMeasure
    } & ItemFilter)
  | ({ new: 'measure'; activity_type: string; measure: ActivityMeasure } & ItemFilter)

const SOURCE_TYPES: readonly string[] = [
  'tag',
  'metric',
  'productivity_category',
  'activity_type',
] satisfies TrendSourceType[]
const DISPLAY_PERIODS: readonly string[] = ['daily', 'weekly', 'monthly'] satisfies TrendDisplayPeriod[]
const TREND_AGGREGATIONS: readonly string[] = ['count', 'sum', 'mean'] satisfies TrendAggregation[]

const filterOf = ({ filter_field, filter_value }: ItemFilter): Required<ItemFilter> | undefined =>
  filter_field && filter_value ? { filter_field, filter_value } : undefined

/** The Goals page with a new goal prefilled from a chart; the user types the target there. */
export const goalsHref = (prefill: GoalPrefill): string => {
  const params = new URLSearchParams({ new: prefill.new })
  const set = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  if (prefill.new === 'trend') {
    set('source_type', prefill.source_type)
    set('pattern', prefill.pattern)
    set('half_life_days', prefill.half_life_days)
    set('display_period', prefill.display_period)
    set('aggregation', prefill.aggregation)
  } else {
    set('activity_type', prefill.activity_type)
  }
  set('measure', prefill.measure)
  const filter = prefill.measure ? filterOf(prefill) : undefined
  if (filter) {
    set('filter_field', filter.filter_field)
    set('filter_value', filter.filter_value)
  }
  return `/goals?${params.toString()}`
}

const parseMeasure = (raw: string | undefined): ActivityMeasure | undefined =>
  (activityMeasures as readonly string[]).includes(raw ?? '') ? (raw as ActivityMeasure) : undefined

const parseHalfLife = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const trendGoalFromQuery = (query: Record<string, string>, id: string): TrendGoal | undefined => {
  const { aggregation, display_period, pattern, source_type } = query
  if (!pattern || !SOURCE_TYPES.includes(source_type ?? '')) return undefined
  const measure = parseMeasure(query.measure)
  const filter = measure ? filterOf(query) : undefined
  return {
    ...(aggregation && TREND_AGGREGATIONS.includes(aggregation)
      ? { aggregation: aggregation as TrendAggregation }
      : {}),
    display_period:
      display_period && DISPLAY_PERIODS.includes(display_period)
        ? (display_period as TrendDisplayPeriod)
        : 'monthly',
    ...filter,
    goal_type: 'trend',
    half_life_days: parseHalfLife(
      query.half_life_days,
      measure ? MEASURE_HALF_LIFE_DEFAULT : EMA_HALF_LIFE_DEFAULT,
    ),
    id,
    ...(measure ? { measure } : {}),
    pattern,
    source_type: source_type as TrendSourceType,
  }
}

/** The goal a Goals URL asks to prefill (`new=trend` or `new=measure`), without a target. */
export const goalFromQuery = (query: Record<string, string>, id: string): Goal | undefined => {
  if (query.new === 'trend') return trendGoalFromQuery(query, id)
  if (query.new !== 'measure') return undefined
  const measure = parseMeasure(query.measure)
  if (!measure || !query.activity_type) return undefined
  return {
    activity_type: query.activity_type,
    aggregation: defaultAggregation(measure),
    ...filterOf(query),
    goal_type: 'measure',
    id,
    measure,
    window: '30d',
  }
}
