/**
 * Split into a presentational `CombinedChartView` and a fetching container. Every layer is fetched
 * with the query its own widget would make, over the chart's shared lookback.
 */

import type { CombinedChartConfig, CombinedChartData, CombinedChartLayerData } from '@aurboda/api-spec'

import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { useCallback, useMemo } from 'preact/hooks'

import { fetchChartData, fetchTrend } from '../../state/api'
import { BarChart } from '../charts/BarChart'
import { measureChartTitle } from './chartTitle'
import {
  barsLayerParams,
  type CombinedChartBars,
  combinedChartParts,
  nullLayer,
  trendLayerParams,
} from './combinedChart'
import { HEAVY_QUERY_OPTIONS } from './heavyQuery'

const lookbackToRange = (lookbackDays: number): { start: string; end: string } => {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - lookbackDays)
  return { end: end.toISOString(), start: start.toISOString() }
}

const NO_BUCKETS: CombinedChartBars['buckets'] = []

const combinedChartTitle = ({ layers, title }: CombinedChartConfig): string => {
  if (title) return title
  const bars = layers.find((layer) => layer.kind === 'bars')
  return (bars && (measureChartTitle(bars) ?? bars.pattern)) ?? 'Combined chart'
}

interface CombinedChartViewProps {
  config: CombinedChartConfig
  data: CombinedChartData | null
}

export function CombinedChartView({ config, data }: CombinedChartViewProps) {
  const range = useMemo(() => lookbackToRange(config.lookback_days), [config.lookback_days])
  const { bars, lines } = useMemo(() => combinedChartParts(config, data), [config, data])

  return (
    <div class="chart-widget">
      <h4>{combinedChartTitle(config)}</h4>
      <BarChart
        data={bars?.buckets ?? NO_BUCKETS}
        color="#8b5cf6"
        height={200}
        bucketSize={bars?.bucketSize}
        rangeStart={range.start}
        rangeEnd={range.end}
        lines={lines}
      />
    </div>
  )
}

export function CombinedChartWidget({ config }: { config: CombinedChartConfig }) {
  const { layers, lookback_days } = config

  const combine = useCallback(
    (results: UseQueryResult<CombinedChartLayerData>[]) => ({
      data: results.every((r) => r.isError)
        ? null
        : { layers: results.map((r, i) => r.data ?? nullLayer(layers[i]?.kind ?? 'trend')) },
      isLoading: results.some((r) => r.isLoading),
    }),
    [layers],
  )

  const { data, isLoading } = useQueries({
    combine,
    queries: layers.map((layer) => ({
      queryFn: async (): Promise<CombinedChartLayerData> => {
        if (layer.kind === 'bars') {
          const chart = await fetchChartData(barsLayerParams(layer, lookbackToRange(lookback_days)))
          return { data: { buckets: chart.buckets }, kind: 'bars' }
        }
        const trend = await fetchTrend(trendLayerParams(layer, lookback_days))
        return { data: { current_value: trend.current_value, history: trend.history }, kind: 'trend' }
      },
      queryKey: ['combined-chart-layer', layer, lookback_days],
      ...HEAVY_QUERY_OPTIONS,
      staleTime: 5 * 60 * 1000,
    })),
  })

  if (isLoading) {
    return (
      <div class="chart-widget">
        <h4>{combinedChartTitle(config)}</h4>
        <div class="chart-loading">Loading chart data...</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div class="chart-widget">
        <h4>{combinedChartTitle(config)}</h4>
        <div class="chart-error">Unable to load chart data</div>
      </div>
    )
  }

  return <CombinedChartView config={config} data={data} />
}
