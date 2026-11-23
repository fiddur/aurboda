import {
  type ActivitySessionGroup,
  EXERCISE_PRIMARY_MUSCLE_WEIGHT,
  type ExerciseEquipment,
  exerciseEquipmentInfo,
  type ExerciseMuscleGroup,
  exerciseMuscleGroups,
  exerciseMuscleInfo,
  type StrengthScore,
  type StrengthScoreGroupResult,
  type StrengthScoreLift,
} from '@aurboda/api-spec'

import { formatBestSet, formatMeasure } from '../../utils/measures'
import { filterItemGroups, type ItemGroupSortKey, sortItemGroups } from '../ActivityTypeMeta/itemGroups'
import { scoreGroupOf } from '../StrengthScore/strengthScoreView'

export const MUSCLE_PARAM = 'muscle'

const MAX_MUSCLES_SHOWN = 4

export const muscleGroupOptions = (): { label: string; value: ExerciseMuscleGroup }[] =>
  exerciseMuscleGroups.map((value) => ({ label: exerciseMuscleInfo[value].name, value }))

const isMuscleGroup = (value: unknown): value is ExerciseMuscleGroup =>
  typeof value === 'string' && (exerciseMuscleGroups as readonly string[]).includes(value)

/** The muscle group in the address's `?muscle=`; an unknown value is ignored. */
export const parseMuscleParam = (
  query: Record<string, string | undefined>,
): ExerciseMuscleGroup | undefined => {
  const value = query[MUSCLE_PARAM]
  return isMuscleGroup(value) ? value : undefined
}

/** `search` with `muscle` set, or removed for all muscles; other parameters are kept. */
export const muscleSearch = (search: string, muscle: ExerciseMuscleGroup | undefined): string => {
  const params = new URLSearchParams(search)
  if (muscle) params.set(MUSCLE_PARAM, muscle)
  else params.delete(MUSCLE_PARAM)
  const next = params.toString()
  return next ? `?${next}` : ''
}

/** The equipment that at least one exercise uses, by display name. */
export const equipmentOptions = (
  groups: ActivitySessionGroup[],
): { label: string; value: ExerciseEquipment }[] =>
  [...new Set(groups.flatMap((g) => g.equipment ?? []))]
    .map((value) => ({ label: exerciseEquipmentInfo[value].name, value }))
    .toSorted((a, b) => a.label.localeCompare(b.label))

const muscleWeight = (g: ActivitySessionGroup, muscle: ExerciseMuscleGroup): number | undefined =>
  g.muscle_groups?.find((m) => m.muscle_group === muscle)?.weight

export const mainlyWorks = (g: ActivitySessionGroup, muscle: ExerciseMuscleGroup): boolean =>
  (muscleWeight(g, muscle) ?? 0) >= EXERCISE_PRIMARY_MUSCLE_WEIGHT

export interface ExerciseFilter {
  query: string
  muscle?: ExerciseMuscleGroup
  equipment?: ExerciseEquipment
  sortKey: ItemGroupSortKey
  pointsOf?: (g: ActivitySessionGroup) => number | undefined
}

export interface FilteredExercises {
  shown: ActivitySessionGroup[]
  /** With a muscle group chosen: how many mainly work it and how many also work it. */
  split?: { mainly: number; also: number }
}

/**
 * The exercises to list: searched, narrowed to an equipment and to a muscle group, those that mainly
 * work the group before those that also work it, each part in the sort order. The no-value group
 * shows only without a muscle or equipment filter.
 */
export const filterExercises = (
  groups: ActivitySessionGroup[],
  filter: ExerciseFilter,
): FilteredExercises => {
  const { equipment, muscle, pointsOf, query, sortKey } = filter
  const searched = filterItemGroups(groups, query).filter(
    (g) =>
      (equipment === undefined || (g.equipment ?? []).includes(equipment)) &&
      (g.value !== null || (muscle === undefined && equipment === undefined)),
  )
  if (muscle === undefined) return { shown: sortItemGroups(searched, sortKey, pointsOf) }
  const working = searched.filter((g) => muscleWeight(g, muscle) !== undefined)
  const mainly = sortItemGroups(
    working.filter((g) => mainlyWorks(g, muscle)),
    sortKey,
    pointsOf,
  )
  const also = sortItemGroups(
    working.filter((g) => !mainlyWorks(g, muscle)),
    sortKey,
    pointsOf,
  )
  return { shown: [...mainly, ...also], split: { also: also.length, mainly: mainly.length } }
}

export const muscleSplitLine = (
  split: { mainly: number; also: number },
  muscle: ExerciseMuscleGroup,
): string => {
  const name = exerciseMuscleInfo[muscle].name
  if (split.mainly === 0 && split.also === 0) return `No exercise in this period works ${name}.`
  return [
    ...(split.mainly > 0 ? [`${split.mainly} mainly work ${name}`] : []),
    ...(split.also > 0 ? [`${split.also} also work it`] : []),
  ].join(', ')
}

export interface MusclesLabel {
  primary: string[]
  secondary: string[]
  more: number
}

/** An exercise's muscle groups by name: those it mainly works, then the others, at most four in all. */
export const musclesLabel = (g: ActivitySessionGroup): MusclesLabel => {
  const muscles = g.muscle_groups ?? []
  const ordered = [
    ...muscles.filter((m) => m.weight >= EXERCISE_PRIMARY_MUSCLE_WEIGHT),
    ...muscles.filter((m) => m.weight < EXERCISE_PRIMARY_MUSCLE_WEIGHT),
  ]
  const shown = ordered.slice(0, MAX_MUSCLES_SHOWN)
  const names = (list: typeof muscles) => list.map((m) => exerciseMuscleInfo[m.muscle_group].name)
  return {
    more: ordered.length - shown.length,
    primary: names(shown.filter((m) => m.weight >= EXERCISE_PRIMARY_MUSCLE_WEIGHT)),
    secondary: names(shown.filter((m) => m.weight < EXERCISE_PRIMARY_MUSCLE_WEIGHT)),
  }
}

export interface ExercisePoints {
  points: number
  counted: boolean
}

/** The score of the lift the exercise counts as; undefined when it is no scoring lift or has no score. */
export const exercisePoints = (
  score: StrengthScore | null | undefined,
  catalogKey: string | undefined,
): ExercisePoints | undefined => {
  if (!score || catalogKey === undefined) return undefined
  for (const group of score.groups) {
    const lift = group.lifts.find((l) => l.catalog_keys.includes(catalogKey))
    if (lift) return lift.score === null ? undefined : { counted: lift.counted, points: lift.score }
  }
  return undefined
}

/** The phone row's third line: `{count}× · {volume} · best set {set} · e1RM {e1rm}`, without what is missing. */
export const exerciseSummaryLine = (g: ActivitySessionGroup): string => {
  const volume = g.measures?.volume
  const e1rm = g.measures?.e1rm
  return [
    `${g.count}×`,
    ...(volume === undefined ? [] : [formatMeasure('volume', volume)]),
    ...(g.best_set ? [`best set ${formatBestSet(g.best_set)}`] : []),
    ...(e1rm === undefined ? [] : [`e1RM ${formatMeasure('e1rm', e1rm)}`]),
  ].join(' · ')
}

/** The lifts of the muscle's score group without a best set in the window; undefined when there are none. */
export const liftsNotDone = (
  score: StrengthScore | null | undefined,
  muscle: ExerciseMuscleGroup | undefined,
): { group: StrengthScoreGroupResult; lifts: StrengthScoreLift[] } | undefined => {
  if (muscle === undefined) return undefined
  const group = scoreGroupOf(muscle, score)
  if (!group) return undefined
  const lifts = group.lifts.filter((l) => l.best === undefined)
  return lifts.length > 0 ? { group, lifts } : undefined
}
