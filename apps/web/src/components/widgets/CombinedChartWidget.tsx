import {
  CHART_ALL_TIME_LOOKBACK_DAYS,
  type CombinedChartConfig,
  type CombinedChartData,
  type CombinedChartLayerData,
  journalChartFiltersOf,
} from '@aurboda/api-spec'
import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { useCallback, useMemo } from 'preact/hooks'

import { fetchChartData, fetchTrend } from '../../state/api'
import { CHART_PRIMARY } from '../../theme'
import { allTimeLookbackDays, widgetRange } from '../../utils/chart-range'
import { BarChart } from '../charts/BarChart'
import { useChartFirstDay } from '../charts/useChartFirstDay'
import { barsFetchParams, trendFetchParams } from './chartFetchParams'
import { journalChartTitle, measureChartTitle } from './chartTitle'
import { type CombinedChartBars, combinedChartParts, nullLayer } from './combinedChart'
import { HEAVY_QUERY_OPTIONS } from './heavyQuery'

const lookbackToRange = (lookbackDays: number): { start: string; end: string } => {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - lookbackDays)
  return { end: end.toISOString(), start: start.toISOString() }
}

/** The axis range; an all-time chart shown from resolved data (a public board) spans the data it has. */
const axisRange = (lookbackDays: number): { start?: string; end: string } =>
  lookbackDays === CHART_ALL_TIME_LOOKBACK_DAYS
    ? { end: new Date().toISOString() }
    : lookbackToRange(lookbackDays)

const NO_BUCKETS: CombinedChartBars['buckets'] = []

const combinedChartTitle = ({ layers, title }: CombinedChartConfig): string => {
  if (title) return title
  const bars = layers.find((layer) => layer.kind === 'bars')
  return (bars && (journalChartTitle(bars) ?? measureChartTitle(bars) ?? bars.pattern)) ?? 'Combined chart'
}

interface CombinedChartViewProps {
  config: CombinedChartConfig
  data: CombinedChartData | null
  /** The range the bars were fetched for, when the widget fetched them itself. */
  barsRange?: { start: string; end: string }
}

export function CombinedChartView({ barsRange, config, data }: CombinedChartViewProps) {
  const range = useMemo(() => barsRange ?? axisRange(config.lookback_days), [barsRange, config.lookback_days])
  const { bars, lines } = useMemo(() => combinedChartParts(config, data), [config, data])

  return (
    <div class="chart-widget">
      <h4>{combinedChartTitle(config)}</h4>
      <BarChart
        data={bars?.buckets ?? NO_BUCKETS}
        color={CHART_PRIMARY}
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
  const { layers } = config
  const bars = layers.find((layer) => layer.kind === 'bars')
  const allTime = config.lookback_days === CHART_ALL_TIME_LOOKBACK_DAYS && bars !== undefined
  const { firstDay, pending } = useChartFirstDay(
    {
      ...(bars?.tag_definition_id ? { activity_type_id: bars.tag_definition_id } : {}),
      pattern: bars?.pattern,
      source_type: bars?.source_type ?? 'activity_type',
      ...(bars ? journalChartFiltersOf(bars) : {}),
    },
    allTime,
  )
  const lookback_days = allTime ? allTimeLookbackDays(firstDay, new Date()) : config.lookback_days
  const barsRange = useMemo(
    () => widgetRange(config.lookback_days, undefined, new Date(), firstDay),
    [config.lookback_days, firstDay],
  )

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
          const chart = await fetchChartData(barsFetchParams(layer, barsRange))
          return { data: { buckets: chart.buckets }, kind: 'bars' }
        }
        const trend = await fetchTrend(trendFetchParams(layer, lookback_days))
        return { data: { current_value: trend.current_value, history: trend.history }, kind: 'trend' }
      },
      enabled: !pending,
      queryKey: ['combined-chart-layer', layer, lookback_days],
      ...HEAVY_QUERY_OPTIONS,
      staleTime: 5 * 60 * 1000,
    })),
  })

  if (pending || isLoading) {
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

  return <CombinedChartView config={{ ...config, lookback_days }} data={data} barsRange={barsRange} />
}
