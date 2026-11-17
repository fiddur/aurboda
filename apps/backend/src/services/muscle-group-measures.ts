import {
  type ActivityMeasures,
  type ExerciseMuscle,
  type ExerciseMuscleGroup,
  exerciseMuscleGroups,
  exerciseMuscleInfo,
  type MuscleGroupMeasures,
  NO_MUSCLE_GROUP_NAME,
  type StoredExerciseCatalogEntry,
  summedActivityMeasures,
  UNMAPPED_MUSCLE_GROUP_NAME,
} from '@aurboda/api-spec'

import { groupItemsByKey, measureItems } from './activity-measures.ts'

type Item = Record<string, unknown>

export type ExerciseEntryResolver = (value: string) => StoredExerciseCatalogEntry | undefined

/**
 * Per muscle group the highest weight among the entry's muscles in it, so two heads of one muscle
 * do not count a set twice. Every catalogue entry becomes weights here and nowhere else, so that
 * variants of an exercise can adjust them in one place.
 */
export const muscleGroupWeights = (
  entry: StoredExerciseCatalogEntry,
): Partial<Record<ExerciseMuscleGroup, number>> => {
  const weights: Partial<Record<ExerciseMuscleGroup, number>> = {}
  for (const [muscle, weight] of Object.entries(entry.muscles) as [ExerciseMuscle, number][]) {
    if (!(weight > 0)) continue
    const { group } = exerciseMuscleInfo[muscle]
    weights[group] = Math.max(weights[group] ?? 0, weight)
  }
  return weights
}

/** A muscle group's measures; `muscle_group` null, with `in_catalogue`, for exercises that train none. */
export interface MuscleGroupBucket {
  in_catalogue?: boolean
  measures: ActivityMeasures
  muscle_group: ExerciseMuscleGroup | null
}

export const muscleGroupName = ({
  in_catalogue,
  muscle_group,
}: Omit<MuscleGroupBucket, 'measures'>): string =>
  muscle_group !== null
    ? exerciseMuscleInfo[muscle_group].name
    : in_catalogue
      ? NO_MUSCLE_GROUP_NAME
      : UNMAPPED_MUSCLE_GROUP_NAME

export const round2 = (v: number): number => Math.round(v * 100) / 100

export const roundMeasures = (measures: ActivityMeasures): ActivityMeasures =>
  Object.fromEntries(
    Object.entries(measures).map(([measure, value]) => [measure, round2(value)]),
  ) as ActivityMeasures

const weightedSums = (measures: ActivityMeasures, weight: number): ActivityMeasures => {
  const weighted: ActivityMeasures = {}
  for (const measure of summedActivityMeasures) {
    const value = measures[measure]
    if (value !== undefined) weighted[measure] = value * weight
  }
  return weighted
}

type BucketKey = ExerciseMuscleGroup | 'no_muscle_group' | 'not_in_catalogue'

const bucketOrder: BucketKey[] = [...exerciseMuscleGroups, 'no_muscle_group', 'not_in_catalogue']

const bucketOf = (key: BucketKey): Omit<MuscleGroupBucket, 'measures'> =>
  key === 'no_muscle_group' || key === 'not_in_catalogue'
    ? { in_catalogue: key === 'no_muscle_group', muscle_group: null }
    : { muscle_group: key }

/**
 * The summed measures of a session's items per muscle group: each exercise's measures multiplied by
 * its recruitment weight of every group it trains. An exercise without muscle weights counts fully
 * under `null`, in one bucket when its entry has no muscle data and in another when it has no entry,
 * so the groups add up to at least the session's total.
 */
export const measuresByMuscleGroup = (
  items: Item[],
  key: string,
  resolveEntry: ExerciseEntryResolver,
): MuscleGroupBucket[] => {
  const totals = new Map<BucketKey, ActivityMeasures>()
  for (const group of groupItemsByKey(items, key)) {
    const measures = measureItems(group.items)
    const entry = resolveEntry(group.value)
    const weights = Object.entries(entry ? muscleGroupWeights(entry) : {}) as [ExerciseMuscleGroup, number][]
    const targets: [BucketKey, number][] =
      weights.length > 0 ? weights : [[entry ? 'no_muscle_group' : 'not_in_catalogue', 1]]
    for (const [bucket, weight] of targets) {
      for (const measure of summedActivityMeasures) {
        const value = measures[measure]
        if (value === undefined) continue
        const sums = totals.getOrInsertComputed(bucket, () => ({}))
        sums[measure] = (sums[measure] ?? 0) + value * weight
      }
    }
  }
  return [...totals]
    .toSorted(([a], [b]) => bucketOrder.indexOf(a) - bucketOrder.indexOf(b))
    .map(([bucket, measures]) => ({ ...bucketOf(bucket), measures: roundMeasures(measures) }))
}

/** `measuresByMuscleGroup` with display names, most sets first and the `null` groups last. */
export const muscleGroupSplit = (
  items: Item[],
  key: string,
  resolveEntry: ExerciseEntryResolver,
): MuscleGroupMeasures[] =>
  measuresByMuscleGroup(items, key, resolveEntry)
    .toSorted(
      (a, b) =>
        Number(a.muscle_group === null) - Number(b.muscle_group === null) ||
        (b.measures.set_count ?? 0) - (a.measures.set_count ?? 0),
    )
    .map((g) => ({ ...g, name: muscleGroupName(g) }))

export interface MuscleGroupContribution {
  /** The exercise as logged, spelled as it first appears in the items. */
  value: string
  normalized: string
  /** The exercise's recruitment weight for the group. */
  weight: number
  /** Only the summed measures, each times `weight`, unrounded. */
  measures: ActivityMeasures
}

/**
 * Per exercise among `items` that trains `group`: its summed measures times its recruitment weight.
 * Exercises outside the catalogue, those that do not train the group and those without working sets
 * are left out.
 */
export const muscleGroupContributions = (
  items: Item[],
  key: string,
  resolveEntry: ExerciseEntryResolver,
  group: ExerciseMuscleGroup,
): MuscleGroupContribution[] =>
  groupItemsByKey(items, key).flatMap((g) => {
    const entry = resolveEntry(g.value)
    const weight = entry ? muscleGroupWeights(entry)[group] : undefined
    if (weight === undefined) return []
    const measures = weightedSums(measureItems(g.items), weight)
    return Object.keys(measures).length > 0
      ? [{ measures, normalized: g.normalized, value: g.value, weight }]
      : []
  })
