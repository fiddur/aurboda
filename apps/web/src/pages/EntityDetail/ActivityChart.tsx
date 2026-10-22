/**
 * Activity detail chart — the data half: discovers and buckets all metrics
 * recorded in the activity window (one query, bucket sized to the drawable
 * width), then delegates the rendering — overlays, toggles, crosshair — to the
 * shared `CombinedMetricChart` (also used by the feed's native post cards).
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import type { SleepStage } from '../../components/charts/sleep-utils'

import {
  CHART_MARGIN,
  type CombinedChartSeries,
  CombinedMetricChart,
} from '../../components/charts/CombinedMetricChart'
import { fetchBucketedMetrics } from '../../state/api'

interface ActivityChartProps {
  start: Date
  end: Date
  stages?: SleepStage[]
  defaultMetrics?: string[]
  onHoverTime?: (time: Date | null) => void
  /** Notified with the metrics currently shown on the chart (for the share dialog). */
  onEnabledMetricsChange?: (metrics: string[]) => void
}

type TimeSeries = [Date, number][]

/** Metrics to exclude from the activity chart (cumulative/computed, not useful as overlays). */
const EXCLUDED_METRICS = new Set([
  'calories_active',
  'calories_basal',
  'calories_total',
  'distance',
  'floors_climbed',
  'hr_zone_0_sec',
  'hr_zone_1_sec',
  'hr_zone_2_sec',
  'hr_zone_3_sec',
  'hr_zone_4_sec',
  'hr_zone_5_sec',
  'intensity_minutes',
  'steps',
  'training_impulse',
  'activity_impulse',
])

/** Standard bucket sizes in ascending order of seconds. */
const BUCKET_STEPS = [
  { label: '1s', sec: 1 },
  { label: '2s', sec: 2 },
  { label: '5s', sec: 5 },
  { label: '10s', sec: 10 },
  { label: '15s', sec: 15 },
  { label: '30s', sec: 30 },
  { label: '1m', sec: 60 },
  { label: '2m', sec: 120 },
  { label: '5m', sec: 300 },
  { label: '10m', sec: 600 },
  { label: '15m', sec: 900 },
  { label: '30m', sec: 1800 },
  { label: '1h', sec: 3600 },
]

/** Target ~1 data point per 2mm of chart width. 1mm ≈ 96/25.4 CSS px ≈ 3.78px. */
const PX_PER_POINT = 2 * (96 / 25.4) // ~7.56 CSS px

/**
 * Compute bucket size to yield ~1 data point per 2mm of chart width.
 * Rounds down to the closest smaller standard bucket for at least as many points as needed.
 */
const chooseBucketSize = (start: Date, end: Date, chartWidthPx: number): string => {
  const durationSec = (end.getTime() - start.getTime()) / 1000
  const numPoints = chartWidthPx / PX_PER_POINT
  const idealBucketSec = durationSec / numPoints

  // Find the largest standard bucket that is ≤ idealBucketSec
  let chosen = BUCKET_STEPS[0]!
  for (const step of BUCKET_STEPS) {
    if (step.sec <= idealBucketSec) chosen = step
    else break
  }

  return chosen.label
}

interface MetricChartData {
  metrics: string[]
  series: Map<string, TimeSeries>
}

/** Fetch bucketed metrics — discovers available metrics AND provides chart data in one call. */
const useMetricChartData = (start: Date, end: Date, chartWidthPx: number) => {
  const bucket = chartWidthPx > 0 ? chooseBucketSize(start, end, chartWidthPx) : ''

  return useQuery({
    enabled: chartWidthPx > 0,
    queryFn: async (): Promise<MetricChartData> => {
      const response = await fetchBucketedMetrics(start, end, undefined, bucket)
      const seriesMap = new Map<string, TimeSeries>()

      for (const b of response.buckets ?? []) {
        const time = new Date(b.start)
        for (const [metric, stats] of Object.entries(b.metrics)) {
          if (EXCLUDED_METRICS.has(metric)) continue
          let arr = seriesMap.get(metric)
          if (!arr) {
            arr = []
            seriesMap.set(metric, arr)
          }
          arr.push([time, stats.avg])
        }
      }

      return { metrics: [...seriesMap.keys()].sort(), series: seriesMap }
    },
    // Use bucket label as key so small resize jitter doesn't cause refetches
    queryKey: ['detail-metric-chart-data', start.toISOString(), end.toISOString(), bucket],
    staleTime: 5 * 60 * 1000,
  })
}

export const ActivityChart = ({
  start,
  end,
  stages,
  defaultMetrics,
  onHoverTime,
  onEnabledMetricsChange,
}: ActivityChartProps) => {
  // Measure chart inner width (container minus margins) for pixel-accurate bucket sizing
  const measureRef = useRef<HTMLDivElement>(null)
  const [chartWidthPx, setChartWidthPx] = useState(0)
  useEffect(() => {
    const el = measureRef.current
    if (!el) return
    const measure = () =>
      setChartWidthPx(Math.max(0, el.clientWidth - CHART_MARGIN.left - CHART_MARGIN.right))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const chartDataQuery = useMetricChartData(start, end, chartWidthPx)
  const data = chartDataQuery.data
  // Stable identity per query result: the chart memoises its overlays on the
  // series identity, so a hover-driven parent re-render must not redraw (#1014).
  const series: CombinedChartSeries[] = useMemo(
    () => (data?.metrics ?? []).map((metric) => ({ data: data?.series.get(metric) ?? [], metric })),
    [data],
  )

  return (
    <div ref={measureRef}>
      <CombinedMetricChart
        series={series}
        start={start}
        end={end}
        stages={stages}
        defaultMetrics={defaultMetrics}
        loading={chartDataQuery.isLoading}
        onHoverTime={onHoverTime}
        onEnabledMetricsChange={onEnabledMetricsChange}
      />
    </div>
  )
}
