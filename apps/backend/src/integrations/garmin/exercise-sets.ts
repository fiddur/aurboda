import type { StoredExerciseCatalog } from '@aurboda/api-spec'

import type { Activity } from '../../db/types.ts'
import type { ItemValueResult } from '../../services/item-value-aliases.ts'
import type { ItemValueMapping } from '../../services/item-value-identities.ts'
import type { GarminExerciseSet, GarminExerciseSetsResponse } from './client.ts'

import { insertRawRecord, setGarminActivitySets } from '../../db/index.ts'
import { auditError } from '../../services/audit-log.ts'
import { findExerciseByFit, getExerciseByKey, loadExerciseCatalog } from '../../services/exercise-catalog.ts'
import { aliasActivityData } from '../../services/item-value-aliases.ts'
import { applyItemValueKeysForWrite } from '../../services/item-value-identities.ts'
import { garminActivityExternalId } from '../../services/source-identity.ts'
import { makeRaw } from './process.ts'

export const UNKNOWN_EXERCISE = 'Unknown exercise'

export type GarminSet = Record<string, unknown>

type SetsData = { sets: GarminSet[] }

export interface GarminExerciseSetsDeps {
  aliasActivityData: (user: string, data: SetsData) => Promise<SetsData>
  applyItemValueKeysForWrite: (
    user: string,
    activityType: string,
    data: SetsData,
  ) => Promise<ItemValueResult<{ data: SetsData; mappings: ItemValueMapping[] }>>
  auditError: typeof auditError
  insertRawRecord: typeof insertRawRecord
  loadExerciseCatalog: () => StoredExerciseCatalog
  setGarminActivitySets: typeof setGarminActivitySets
}

/** Built on use, so importing this module reads no export of a test's partial `db` mock. */
const defaultDeps = (): GarminExerciseSetsDeps => ({
  aliasActivityData,
  applyItemValueKeysForWrite,
  auditError,
  insertRawRecord,
  loadExerciseCatalog,
  setGarminActivitySets,
})

const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const fitPart = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase()

const titleCase = (key: string): string =>
  key
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')

const likeliestExercise = (set: GarminExerciseSet) =>
  (set.exercises ?? []).reduce<NonNullable<GarminExerciseSet['exercises']>[number] | undefined>(
    (best, candidate) =>
      best === undefined || (candidate.probability ?? 0) > (best.probability ?? 0) ? candidate : best,
    undefined,
  )

const exerciseOf = (set: GarminExerciseSet, catalog: StoredExerciseCatalog): GarminSet => {
  const exercise = likeliestExercise(set)
  const category = fitPart(exercise?.category)
  const name = fitPart(exercise?.name)
  if (category === '' || category === 'unknown') return { exercise: UNKNOWN_EXERCISE }
  const own = name || category
  const entry = findExerciseByFit(catalog, `${category}/${own}`)
  return entry ? { exercise_key: entry.key } : { exercise: titleCase(own) }
}

/** The active sets of a Garmin `exerciseSets` response, named by catalogue key where the FIT key is known. */
export const buildGarminSets = (
  response: GarminExerciseSetsResponse | null | undefined,
  catalog: StoredExerciseCatalog,
): GarminSet[] =>
  (Array.isArray(response?.exerciseSets) ? response.exerciseSets : []).flatMap((set) => {
    if (set.setType === 'REST') return []
    const reps = positive(set.repetitionCount) ? set.repetitionCount : undefined
    const weight = positive(set.weight) ? Math.round(set.weight / 10) / 100 : undefined
    const time = reps === undefined && positive(set.duration) ? Math.round(set.duration) : undefined
    if (reps === undefined && time === undefined) return []
    return [
      {
        ...exerciseOf(set, catalog),
        ...(reps === undefined ? {} : { reps }),
        ...(weight === undefined ? {} : { weight }),
        ...(time === undefined ? {} : { time }),
      },
    ]
  })

/** Any set still carrying `exercise_key` takes the catalogue entry's name instead, so no key is stored. */
export const nameKeyedSets = (sets: GarminSet[], catalog: StoredExerciseCatalog): GarminSet[] =>
  sets.map((set) => {
    if (!('exercise_key' in set)) return set
    const { exercise_key: key, ...rest } = set
    const name = typeof key === 'string' ? getExerciseByKey(catalog, key)?.name : undefined
    return { ...rest, exercise: name ?? rest.exercise ?? UNKNOWN_EXERCISE }
  })

/**
 * Store the sets of one Garmin strength activity on its row. Returns how many were stored, or null
 * when the names could not be resolved and the row was left for the next run.
 */
export const importActivityExerciseSets = async (
  user: string,
  activity: Pick<Activity, 'data' | 'id' | 'start_time'>,
  response: GarminExerciseSetsResponse,
  deps: GarminExerciseSetsDeps = defaultDeps(),
): Promise<number | null> => {
  const garminActivityId = activity.data?.garmin_activity_id as number | string
  if (!activity.id) return null
  await deps.insertRawRecord(
    user,
    makeRaw(
      'garmin_exercise_sets',
      garminActivityExternalId(garminActivityId),
      activity.start_time,
      response,
    ),
  )

  const catalog = deps.loadExerciseCatalog()
  const built = buildGarminSets(response, catalog)
  const keyed = await deps.applyItemValueKeysForWrite(user, 'strength_training', { sets: built })
  if (!keyed.success) {
    deps.auditError(user, 'sync', `Could not name the sets of Garmin activity ${garminActivityId}`, {
      error: keyed.error,
    })
    return null
  }
  const aliased = await deps.aliasActivityData(user, keyed.data.data)
  const sets = nameKeyedSets(aliased.sets, catalog)
  await deps.setGarminActivitySets(user, activity.id, sets)
  return sets.length
}
