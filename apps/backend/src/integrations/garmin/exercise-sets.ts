import type { StoredExerciseCatalog } from '@aurboda/api-spec'

import type { Activity } from '../../db/types.ts'
import type { GarminExerciseSet, GarminExerciseSetsResponse } from './client.ts'

import { insertRawRecord, setGarminActivitySets } from '../../db/index.ts'
import { auditError } from '../../services/audit-log.ts'
import { loadExerciseCatalog } from '../../services/exercise-catalog.ts'
import { aliasActivityData } from '../../services/item-value-aliases.ts'
import { applyItemValueKeysForWrite } from '../../services/item-value-identities.ts'
import { garminActivityExternalId } from '../../services/source-identity.ts'
import {
  garminExercise,
  type GarminSet,
  garminSetMeasures,
  type GarminSetNamingDeps,
  nameGarminSets,
} from './exercise-names.ts'
import { makeRaw } from './process.ts'

export { type GarminSet, nameKeyedSets, UNKNOWN_EXERCISE } from './exercise-names.ts'

export interface GarminExerciseSetsDeps extends GarminSetNamingDeps {
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

const fitPart = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase()

const likeliestExercise = (set: GarminExerciseSet) =>
  (set.exercises ?? []).reduce<NonNullable<GarminExerciseSet['exercises']>[number] | undefined>(
    (best, candidate) =>
      best === undefined || (candidate.probability ?? 0) > (best.probability ?? 0) ? candidate : best,
    undefined,
  )

const exerciseOf = (set: GarminExerciseSet, catalog: StoredExerciseCatalog): GarminSet => {
  const exercise = likeliestExercise(set)
  return garminExercise(catalog, fitPart(exercise?.category), fitPart(exercise?.name))
}

/** The active sets of a Garmin `exerciseSets` response, named by catalogue key where the FIT key is known. */
export const buildGarminSets = (
  response: GarminExerciseSetsResponse | null | undefined,
  catalog: StoredExerciseCatalog,
): GarminSet[] =>
  (Array.isArray(response?.exerciseSets) ? response.exerciseSets : []).flatMap((set) => {
    if (set.setType === 'REST') return []
    const measures = garminSetMeasures({
      reps: set.repetitionCount,
      seconds: set.duration,
      weightKg: typeof set.weight === 'number' ? set.weight / 1000 : undefined,
    })
    return measures ? [{ ...exerciseOf(set, catalog), ...measures }] : []
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
  const named = await nameGarminSets(user, built, catalog, deps)
  if ('error' in named) {
    deps.auditError(user, 'sync', `Could not name the sets of Garmin activity ${garminActivityId}`, {
      error: named.error,
    })
    return null
  }
  await deps.setGarminActivitySets(user, activity.id, named.sets)
  return named.sets.length
}
