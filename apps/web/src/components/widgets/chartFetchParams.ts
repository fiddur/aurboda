import type { BarChartConfig, TrendChartConfig } from '@aurboda/api-spec'

import type { FetchChartDataParams } from '../../state/api/chart-data'
import type { FetchTrendParams } from '../../state/api/trends'

import { EMA_HALF_LIFE_DEFAULT, MEASURE_HALF_LIFE_DEFAULT } from '../../utils/half-life'

type BarsSource = Pick<
  BarChartConfig,
  | 'aggregation'
  | 'bucket_size'
  | 'filter_field'
  | 'filter_value'
  | 'measure'
  | 'pattern'
  | 'source_type'
  | 'tag_definition_id'
>

type TrendSource = Pick<
  TrendChartConfig,
  | 'aggregation'
  | 'display_period'
  | 'filter_field'
  | 'filter_value'
  | 'half_life_days'
  | 'measure'
  | 'missing_days'
  | 'pattern'
  | 'source_type'
>

/** The chart-data query of a bar chart source: shared by the bar chart widget and a combined chart's bars layer. */
export const barsFetchParams = (
  source: BarsSource,
  range: { start: string; end: string },
): FetchChartDataParams => {
  const { aggregation = 'count', bucket_size, filter_field, filter_value, measure, pattern } = source
  return {
    aggregation,
    bucket_size,
    end: range.end,
    pattern,
    source_type: source.source_type,
    start: range.start,
    ...(source.tag_definition_id ? { activity_type_id: source.tag_definition_id } : {}),
    ...(measure ? { measure } : {}),
    ...(measure && filter_field && filter_value ? { filter_field, filter_value } : {}),
  }
}

/** The trend query of a trend chart source: shared by the trend chart widget and a combined chart's trend layer. */
export const trendFetchParams = (source: TrendSource, lookbackDays: number): FetchTrendParams => {
  const { filter_field, filter_value, measure, missing_days, source_type } = source
  return {
    ...(measure
      ? { filter_field, filter_value, measure }
      : {
          aggregation: source.aggregation ?? (source_type === 'metric' ? 'mean' : 'count'),
          display_period: source.display_period ?? 'monthly',
        }),
    half_life_days: source.half_life_days ?? (measure ? MEASURE_HALF_LIFE_DEFAULT : EMA_HALF_LIFE_DEFAULT),
    lookback_days: lookbackDays,
    pattern: source.pattern,
    source_type,
    ...(missing_days ? { missing_days } : {}),
  }
}
