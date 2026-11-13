import {
  type ActivityMeasures,
  type ExerciseMuscle,
  type ExerciseMuscleGroup,
  exerciseMuscleGroups,
  exerciseMuscleInfo,
  type MuscleGroupMeasures,
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

export const muscleGroupName = (group: ExerciseMuscleGroup | null): string =>
  group === null ? UNMAPPED_MUSCLE_GROUP_NAME : exerciseMuscleInfo[group].name

const round2 = (v: number): number => Math.round(v * 100) / 100

const groupOrder = (group: ExerciseMuscleGroup | null): number =>
  group === null ? exerciseMuscleGroups.length : exerciseMuscleGroups.indexOf(group)

/**
 * The summed measures of a session's items per muscle group: each exercise's measures multiplied by
 * its recruitment weight of every group it trains. An exercise without a catalogue entry or without
 * muscle weights counts fully under `null`, so the groups add up to at least the session's total.
 */
export const measuresByMuscleGroup = (
  items: Item[],
  key: string,
  resolveEntry: ExerciseEntryResolver,
): { muscle_group: ExerciseMuscleGroup | null; measures: ActivityMeasures }[] => {
  const totals = new Map<ExerciseMuscleGroup | null, ActivityMeasures>()
  for (const group of groupItemsByKey(items, key)) {
    const measures = measureItems(group.items)
    const entry = resolveEntry(group.value)
    const weights = Object.entries(entry ? muscleGroupWeights(entry) : {}) as [ExerciseMuscleGroup, number][]
    const targets: [ExerciseMuscleGroup | null, number][] = weights.length > 0 ? weights : [[null, 1]]
    for (const [muscleGroup, weight] of targets) {
      for (const measure of summedActivityMeasures) {
        const value = measures[measure]
        if (value === undefined) continue
        const sums = totals.getOrInsertComputed(muscleGroup, () => ({}))
        sums[measure] = (sums[measure] ?? 0) + value * weight
      }
    }
  }
  return [...totals]
    .toSorted(([a], [b]) => groupOrder(a) - groupOrder(b))
    .map(([muscle_group, measures]) => ({
      measures: Object.fromEntries(
        Object.entries(measures).map(([measure, value]) => [measure, round2(value)]),
      ) as ActivityMeasures,
      muscle_group,
    }))
}

/** `measuresByMuscleGroup` with display names, most sets first and `null` last. */
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
    .map((g) => ({ ...g, name: muscleGroupName(g.muscle_group) }))
