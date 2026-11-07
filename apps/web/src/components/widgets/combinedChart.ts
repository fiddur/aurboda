import type {
  BarChartData,
  CombinedChartConfig,
  CombinedChartData,
  CombinedChartLayer,
  CombinedChartLayerData,
} from '@aurboda/api-spec'

import type { BarChartLine } from '../charts/bar-chart-utils'

type BarsLayer = Extract<CombinedChartLayer, { kind: 'bars' }>

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
