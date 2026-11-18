import type { StoredExerciseCatalog } from '@aurboda/api-spec'

import type { ItemValueResult } from '../../services/item-value-aliases.ts'
import type { ItemValueMapping } from '../../services/item-value-identities.ts'

import { findExerciseByFit, getExerciseByKey } from '../../services/exercise-catalog.ts'

export const UNKNOWN_EXERCISE = 'Unknown exercise'

export type GarminSet = Record<string, unknown>

type SetsData = { sets: GarminSet[] }

export interface GarminSetNamingDeps {
  aliasActivityData: (user: string, data: SetsData) => Promise<SetsData>
  applyItemValueKeysForWrite: (
    user: string,
    activityType: string,
    data: SetsData,
  ) => Promise<ItemValueResult<{ data: SetsData; mappings: ItemValueMapping[] }>>
}

export const titleCase = (key: string): string =>
  key
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')

const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/** Reps and weight in kg when positive, the whole seconds only for a set without reps; null when neither count is there. */
export const garminSetMeasures = ({
  reps,
  seconds,
  weightKg,
}: {
  reps?: unknown
  seconds?: unknown
  weightKg?: unknown
}): GarminSet | null => {
  const count = positive(reps) ? reps : undefined
  const time = count === undefined && positive(seconds) ? Math.round(seconds) : undefined
  if (count === undefined && time === undefined) return null
  return {
    ...(count === undefined ? {} : { reps: count }),
    ...(positive(weightKg) ? { weight: Math.round(weightKg * 100) / 100 } : {}),
    ...(time === undefined ? {} : { time }),
  }
}

/**
 * One set's exercise from its FIT category and name keys (snake_case, `name` may be empty): the
 * catalogue key when the pair is known, else `customName`, else the name in title case.
 */
export const garminExercise = (
  catalog: StoredExerciseCatalog,
  category: string,
  name: string,
  customName?: string,
): GarminSet => {
  if (category === '' || category === 'unknown') return { exercise: UNKNOWN_EXERCISE }
  const own = name || category
  const entry = findExerciseByFit(catalog, `${category}/${own}`)
  if (entry) return { exercise_key: entry.key }
  return { exercise: customName?.trim() || titleCase(own) }
}

/** Any set still carrying `exercise_key` takes the catalogue entry's name instead, so no key is stored. */
export const nameKeyedSets = (sets: GarminSet[], catalog: StoredExerciseCatalog): GarminSet[] =>
  sets.map((set) => {
    if (!('exercise_key' in set)) return set
    const { exercise_key: key, ...rest } = set
    const name = typeof key === 'string' ? getExerciseByKey(catalog, key)?.name : undefined
    return { ...rest, exercise: name ?? rest.exercise ?? UNKNOWN_EXERCISE }
  })

/** The sets as they are stored: keyed to the user's item values, aliased, then named; an error when keying failed. */
export const nameGarminSets = async (
  user: string,
  built: GarminSet[],
  catalog: StoredExerciseCatalog,
  deps: GarminSetNamingDeps,
): Promise<{ sets: GarminSet[] } | { error: string }> => {
  const keyed = await deps.applyItemValueKeysForWrite(user, 'strength_training', { sets: built })
  if (!keyed.success) return { error: keyed.error }
  const aliased = await deps.aliasActivityData(user, keyed.data.data)
  return { sets: nameKeyedSets(aliased.sets, catalog) }
}
