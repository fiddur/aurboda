import type { SharedExerciseData } from '@aurboda/api-spec'

import { activityMeasureLabels } from '@aurboda/api-spec'
import { useMemo } from 'preact/hooks'

import { BarChart } from './BarChart'
import { exerciseLineTrend } from './exercise-chart'
import { TrendLineChart } from './TrendLineChart'
import './ExerciseChart.css'

/**
 * The exercise's one chart: weekly bars of the per-week measure with the
 * decaying-best line over them when the trend tracks the same measure.
 * Falls back to the trend line alone where no bars could be built.
 */
export function ExerciseChart({
  perWeek,
  trend,
  height = 220,
}: Pick<SharedExerciseData, 'trend'> & { perWeek: SharedExerciseData['per_week']; height?: number }) {
  const lineTrend = exerciseLineTrend(perWeek, trend)
  const lines = useMemo(() => (lineTrend ? [{ data: lineTrend.history }] : undefined), [lineTrend])

  if (perWeek) {
    return (
      <>
        <BarChart
          data={perWeek.buckets}
          color="#8b5cf6"
          height={height}
          bucketSize="1w"
          rangeStart={perWeek.start}
          rangeEnd={perWeek.end}
          lines={lines}
        />
        <p class="exercise-chart-caption">
          {lineTrend
            ? `${activityMeasureLabels[perWeek.measure]} of each week; the line is the decaying best, with a ${lineTrend.half_life_days}-day half-life between sessions.`
            : `${activityMeasureLabels[perWeek.measure]}, ${perWeek.aggregation === 'max' ? 'the best' : 'the total'} of each week.`}
        </p>
      </>
    )
  }
  if (!trend) return null
  return (
    <>
      <TrendLineChart data={trend.history} color="#8b5cf6" height={height} />
      <p class="exercise-chart-caption">
        {activityMeasureLabels[trend.measure]}, decaying with a {trend.half_life_days}-day half-life between
        sessions.
      </p>
    </>
  )
}
