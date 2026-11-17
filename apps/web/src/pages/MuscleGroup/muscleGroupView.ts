import {
  type BarChartConfig,
  type ExerciseMuscleGroup,
  exerciseMuscleGroups,
  MUSCLE_GROUP_SUFFIX,
  type MuscleGroupSession,
  type SummedActivityMeasure,
} from '@aurboda/api-spec'
import {
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfWeek,
  subDays,
} from 'date-fns'

import { buildChartUrl } from '../../utils/chart-url'

export const MUSCLE_GROUP_PERIODS = [
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
  { label: '2 years', value: 730 },
]

export const MUSCLE_GROUP_MEASURES: SummedActivityMeasure[] = ['set_count', 'volume', 'total_reps']

const WEEK_STARTS_ON = 1

export const isMuscleGroup = (group: string): group is ExerciseMuscleGroup =>
  (exerciseMuscleGroups as readonly string[]).includes(group)

export interface MuscleGroupPeriod {
  /** The chart's axis end: the end of the current bucket, so it is drawn whole. */
  axis_end: string
  bucket_size: '1w' | '1M'
  end: string
  start: string
}

/** Weekly buckets up to a year, monthly beyond. */
export const muscleGroupPeriod = (days: number, now: Date): MuscleGroupPeriod => {
  const monthly = days > 365
  return {
    axis_end: (monthly ? endOfMonth(now) : endOfWeek(now, { weekStartsOn: WEEK_STARTS_ON })).toISOString(),
    bucket_size: monthly ? '1M' : '1w',
    end: endOfDay(now).toISOString(),
    start: startOfDay(subDays(now, days)).toISOString(),
  }
}

/** The weighted sets of the sessions since Monday 00:00 local time. */
export const setsThisWeek = (
  sessions: Pick<MuscleGroupSession, 'measures' | 'start_time'>[],
  now: Date,
): number => {
  const from = startOfWeek(now, { weekStartsOn: WEEK_STARTS_ON }).getTime()
  return sessions
    .filter((s) => new Date(s.start_time).getTime() >= from)
    .reduce((sum, s) => sum + (s.measures.set_count ?? 0), 0)
}

/** The period's total over its weeks, a period shorter than a week counting as one. */
export const averagePerWeek = (total: number, periodDays: number): number =>
  total / Math.max(periodDays / 7, 1)

/** "Today", "Yesterday", "12 days ago", "Never"; the short form reads "12 d ago" and "1 d ago". */
export const lastTrainedLabel = (
  lastTrained: string | null,
  now: Date,
  form: 'long' | 'short' = 'long',
): string => {
  if (lastTrained === null) return 'Never'
  const days = Math.max(differenceInCalendarDays(now, new Date(lastTrained)), 0)
  if (days === 0) return 'Today'
  if (form === 'short') return `${days} d ago`
  return days === 1 ? 'Yesterday' : `${days} days ago`
}

/** A recruitment weight as a plain number: `1`, `0.5`, `0.25`. */
export const recruitmentLabel = (weight: number): string => String(Number(weight.toFixed(2)))

type MuscleGroupChart = Required<
  Pick<
    BarChartConfig,
    | 'aggregation'
    | 'breakdown_fields'
    | 'bucket_size'
    | 'filter_field'
    | 'filter_value'
    | 'measure'
    | 'pattern'
    | 'source_type'
  >
>

/** One muscle group's summed measure per bucket, one series per exercise. */
export const muscleGroupChart = ({
  bucket_size,
  field,
  group,
  measure,
  name,
}: {
  bucket_size: '1w' | '1M'
  field: string
  group: ExerciseMuscleGroup
  measure: SummedActivityMeasure
  name: string
}): MuscleGroupChart => ({
  aggregation: 'sum',
  breakdown_fields: [field],
  bucket_size,
  filter_field: `${field}${MUSCLE_GROUP_SUFFIX}`,
  filter_value: group,
  measure,
  pattern: name,
  source_type: 'activity_type',
})

export const muscleGroupExploreHref = (chart: MuscleGroupChart, lookbackDays: number): string =>
  buildChartUrl({ ...chart, chart_type: 'bar', lookback_days: lookbackDays })

export const muscleGroupWidgetConfig = (
  chart: MuscleGroupChart,
  lookbackDays: number,
  title: string,
): BarChartConfig => ({ ...chart, lookback_days: lookbackDays, ...(title ? { title } : {}) })
