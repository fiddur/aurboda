import {
  type ChartDataBreakdownBucket,
  type ExerciseMuscleGroup,
  exerciseMuscleGroups,
  exerciseMuscleInfo,
  NO_MUSCLE_GROUP_NAME,
  UNMAPPED_MUSCLE_GROUP_NAME,
} from '@aurboda/api-spec'

export type MuscleGroupSummaryKind = 'group' | 'no_muscle_group' | 'not_in_catalogue'

export interface MuscleGroupSummaryRow {
  /** The weekly average as a share of the largest weekly average, 0 to 1. */
  bar: number
  kind: MuscleGroupSummaryKind
  /** The group's key, for `kind: 'group'`. */
  muscle_group?: ExerciseMuscleGroup
  name: string
  per_week: number
  this_week: number
  trained: boolean
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * One row per muscle group of the catalogue, from weekly `set_count` buckets broken down by muscle
 * group: the trained groups most sets first, then the untrained ones in catalogue order, then the
 * sets of exercises without muscle data and, last, of exercises not in the catalogue. The current
 * week is the bucket that started within the last seven days, whatever the server's time zone.
 */
export const muscleGroupSummary = ({
  buckets,
  now,
  period_days,
}: {
  buckets: ChartDataBreakdownBucket[]
  now: Date
  period_days: number
}): MuscleGroupSummaryRow[] => {
  const weeks = Math.max(period_days / 7, 1)
  const thisWeekFrom = now.getTime() - WEEK_MS
  const totals = new Map<string, { this_week: number; total: number }>()
  for (const bucket of buckets) {
    const start = new Date(bucket.bucket_start).getTime()
    const current = start > thisWeekFrom && start <= now.getTime()
    for (const [name, value] of Object.entries(bucket.series)) {
      const sums = totals.get(name) ?? { this_week: 0, total: 0 }
      totals.set(name, sums)
      sums.total += value
      if (current) sums.this_week += value
    }
  }

  const rowOf = (name: string, kind: MuscleGroupSummaryKind) => {
    const sums = totals.get(name)
    return {
      kind,
      name,
      per_week: (sums?.total ?? 0) / weeks,
      this_week: sums?.this_week ?? 0,
      trained: (sums?.total ?? 0) > 0,
    }
  }
  const groups = exerciseMuscleGroups.map((group) => ({
    ...rowOf(exerciseMuscleInfo[group].name, 'group'),
    muscle_group: group,
  }))
  const outside = [
    rowOf(NO_MUSCLE_GROUP_NAME, 'no_muscle_group'),
    rowOf(UNMAPPED_MUSCLE_GROUP_NAME, 'not_in_catalogue'),
  ].filter((row) => row.trained)
  const rows = [
    ...groups
      .filter((row) => row.trained)
      .toSorted((a, b) => b.per_week - a.per_week || b.this_week - a.this_week),
    ...groups.filter((row) => !row.trained),
    ...outside,
  ]
  const max = Math.max(0, ...rows.map((row) => row.per_week))
  return rows.map((row) => ({ ...row, bar: max > 0 ? row.per_week / max : 0 }))
}
