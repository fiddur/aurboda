import type {
  BarChartData,
  CombinedChartConfig,
  CombinedChartData,
  CombinedChartLayer,
  CombinedChartLayerData,
} from '@aurboda/api-spec'

import type { FetchChartDataParams } from '../../state/api/chart-data'
import type { FetchTrendParams } from '../../state/api/trends'
import type { BarChartLine } from '../charts/bar-chart-utils'

import { EMA_HALF_LIFE_DEFAULT, MEASURE_HALF_LIFE_DEFAULT } from '../../utils/half-life'

type BarsLayer = Extract<CombinedChartLayer, { kind: 'bars' }>
type TrendLayer = Extract<CombinedChartLayer, { kind: 'trend' }>

/** The same chart-data query a bar chart widget of this source makes. */
export const barsLayerParams = (
  layer: BarsLayer,
  range: { start: string; end: string },
): FetchChartDataParams => {
  const { aggregation = 'count', bucket_size, filter_field, filter_value, measure, pattern } = layer
  return {
    aggregation,
    bucket_size,
    end: range.end,
    pattern,
    source_type: layer.source_type,
    start: range.start,
    ...(layer.tag_definition_id ? { activity_type_id: layer.tag_definition_id } : {}),
    ...(measure ? { measure } : {}),
    ...(measure && filter_field && filter_value ? { filter_field, filter_value } : {}),
  }
}

/** The same trend query a trend chart widget of this source makes. */
export const trendLayerParams = (layer: TrendLayer, lookbackDays: number): FetchTrendParams => {
  const { filter_field, filter_value, measure, missing_days, source_type } = layer
  return {
    ...(measure
      ? { filter_field, filter_value, measure }
      : {
          aggregation: layer.aggregation ?? (source_type === 'metric' ? 'mean' : 'count'),
          display_period: layer.display_period ?? 'monthly',
        }),
    half_life_days: layer.half_life_days ?? (measure ? MEASURE_HALF_LIFE_DEFAULT : EMA_HALF_LIFE_DEFAULT),
    lookback_days: lookbackDays,
    pattern: layer.pattern,
    source_type,
    ...(missing_days ? { missing_days } : {}),
  }
}

export const nullLayer = (kind: CombinedChartLayer['kind']): CombinedChartLayerData =>
  kind === 'bars' ? { data: null, kind: 'bars' } : { data: null, kind: 'trend' }

export interface CombinedChartBars {
  bucketSize: BarsLayer['bucket_size']
  buckets: BarChartData['buckets']
}

/** The bars to draw and the lines over them, from the layers in config order. */
export const combinedChartParts = (
  config: CombinedChartConfig,
  data: CombinedChartData | null,
): { bars: CombinedChartBars | null; lines: BarChartLine[] } => {
  let bars: CombinedChartBars | null = null
  const lines: BarChartLine[] = []
  for (const [i, layer] of config.layers.entries()) {
    const resolved = data?.layers[i]
    if (layer.kind === 'bars') {
      bars ??= {
        bucketSize: layer.bucket_size,
        buckets: resolved?.kind === 'bars' && resolved.data ? resolved.data.buckets : [],
      }
    } else if (resolved?.kind === 'trend' && resolved.data) {
      lines.push({ data: resolved.data.history, ...(layer.color ? { color: layer.color } : {}) })
    }
  }
  return { bars, lines }
}
