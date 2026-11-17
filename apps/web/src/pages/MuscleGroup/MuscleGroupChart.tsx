import {
  activityMeasureLabels,
  type ExerciseMuscleGroup,
  type SummedActivityMeasure,
} from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'preact/hooks'

import { BarChart } from '../../components/charts/BarChart'
import { breakdownBarSeries, BreakdownLegend } from '../../components/charts/breakdown'
import { ChartMenu } from '../../components/charts/ChartMenu'
import { fetchChartData } from '../../state/api'
import { newWidgetId } from '../../utils/widget-id'
import {
  MUSCLE_GROUP_MEASURES,
  muscleGroupChart,
  muscleGroupExploreHref,
  type MuscleGroupPeriod,
  muscleGroupWidgetConfig,
} from './muscleGroupView'

const NO_BUCKETS: { bucket_start: string; value: number }[] = []

const CAPTION =
  'Each set counts by how much the exercise recruits the muscle group: 1 for a primary mover, less for a secondary one.'

const ChartBody = ({
  chart,
  groupName,
  period,
}: {
  chart: ReturnType<typeof muscleGroupChart>
  groupName: string
  period: MuscleGroupPeriod
}) => {
  const query = useQuery({
    queryFn: () => fetchChartData({ ...chart, end: period.end, start: period.start }),
    queryKey: ['chart-data', 'muscle-group', chart, period.start, period.end],
    staleTime: 5 * 60 * 1000,
  })
  const series = query.data?.breakdown_series
  const buckets = query.data?.breakdown_buckets
  const multiSeries = useMemo(() => breakdownBarSeries(series, buckets), [series, buckets])

  if (query.isLoading) return <p class="loading">Loading...</p>
  if (query.isError) return <p class="error">Failed to load the chart</p>
  if (!series || series.length === 0 || !multiSeries) {
    return <p class="activity-type-item-empty">No sets for {groupName} in this period.</p>
  }
  return (
    <>
      <BreakdownLegend series={series} />
      <BarChart
        data={NO_BUCKETS}
        height={220}
        bucketSize={chart.bucket_size}
        rangeStart={period.start}
        rangeEnd={period.axis_end}
        multiSeries={multiSeries}
        stacked
      />
      <p class="activity-type-item-caption">{CAPTION}</p>
    </>
  )
}

/** The group's summed measure per bucket, stacked by exercise. */
export const MuscleGroupChart = ({
  field,
  group,
  groupName,
  lookbackDays,
  name,
  period,
}: {
  field: string
  group: ExerciseMuscleGroup
  groupName: string
  lookbackDays: number
  name: string
  period: MuscleGroupPeriod
}) => {
  const [measure, setMeasure] = useState<SummedActivityMeasure>('set_count')
  const chart = muscleGroupChart({ bucket_size: period.bucket_size, field, group, measure, name })

  return (
    <section class="activity-type-item-section">
      <div class="activity-type-item-section-header">
        <h2>{activityMeasureLabels[measure]}</h2>
        <select
          aria-label="Measure"
          value={measure}
          onChange={(e) => setMeasure((e.target as HTMLSelectElement).value as SummedActivityMeasure)}
        >
          {MUSCLE_GROUP_MEASURES.map((m) => (
            <option key={m} value={m}>
              {activityMeasureLabels[m]}
            </option>
          ))}
        </select>
        <ChartMenu
          exploreHref={muscleGroupExploreHref(chart, lookbackDays)}
          widget={(title) => ({
            config: muscleGroupWidgetConfig(chart, lookbackDays, title),
            id: newWidgetId(),
            type: 'bar_chart',
          })}
        />
      </div>
      <ChartBody chart={chart} groupName={groupName} period={period} />
    </section>
  )
}
