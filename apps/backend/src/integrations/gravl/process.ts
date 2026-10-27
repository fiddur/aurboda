/**
 * A Gravl workout becomes a `strength_training` activity keyed by
 * `gravl-workout-<uuid>` — the same identity the Health Connect processor
 * derives from Gravl's `clientRecordId` (#1080). So when the session already
 * reached us through Health Connect (timing, HR), this upsert lands on that
 * row and adds what only the Gravl API has: the sets.
 *
 * Sets are stored structurally in `data.sets`, one entry per set with the
 * exercise name repeated, in the shape #1044 defines for repeated data
 * (`exercise`, `weight` in kg, `reps`, `time` in seconds) plus Gravl's extras.
 * A human-readable rendering also goes into a synced note so the detail is
 * visible before the UI can render set arrays.
 *
 * A workout the Gravl app itself imported from another app (`type: 'external'`)
 * is a round-trip: Gravl writes it back into Health Connect under its own
 * `clientRecordId`, so it first lands here as a `gravl` strength session that
 * outranks the original. Those copies are removed rather than ignored, unless
 * sets were logged onto the session in Gravl (#1333): then it is imported like
 * any other workout, restoring a copy an earlier run removed.
 *
 * A workout with no logged set (started and abandoned in Gravl) is not
 * imported either: it carries nothing Aurboda lacks, and its empty row would
 * outrank the watch original the same way. The empty row an earlier run
 * imported for one is removed, and restored once the workout gains sets.
 */

import type { Activity, RawRecord } from '../../db/types.ts'
import type { GravlSet, GravlWorkoutDetail, GravlWorkoutExercise, GravlWorkoutSummary } from './types.ts'

import {
  adoptLegacyActivity,
  findActivityByExternalId,
  insertActivity,
  insertRawRecord,
  materializeSuperseded,
  restoreEmptyImportTombstone,
  restoreSetlessTombstone,
  softDeleteActivityByExternalId,
} from '../../db/index.ts'
import { upsertSyncedNote } from '../../db/notes.ts'
import { auditInfo } from '../../services/audit-log.ts'
import { GRAVL_HC_ORIGIN, gravlWorkoutExternalId } from '../../services/source-identity.ts'

/** Gravl reports every set weight in pounds regardless of the user's unit preference. */
export const LB_PER_KG = 2.20462262

export const lbToKg = (lb: number): number => Math.round((lb / LB_PER_KG) * 1000) / 1000

export type GravlSetKind = 'normal' | 'warmup' | 'drop_set' | 'failure'

/** One set, in the repeated-data shape of #1044 with Gravl's extra fields. */
export interface GravlSetRecord {
  exercise: string
  exercise_id: number
  order: number
  set_type: GravlSetKind
  /** kg */
  weight: number | null
  reps: number | null
  /** seconds */
  time: number | null
  /** metres */
  distance: number | null
  rpe: number | null
  superset_id?: number
}

export interface GravlProcessDeps {
  adoptLegacyActivity: typeof adoptLegacyActivity
  auditInfo: typeof auditInfo
  findActivityByExternalId: typeof findActivityByExternalId
  insertActivity: typeof insertActivity
  insertRawRecord: typeof insertRawRecord
  materializeSuperseded: typeof materializeSuperseded
  restoreEmptyImportTombstone: typeof restoreEmptyImportTombstone
  restoreSetlessTombstone: typeof restoreSetlessTombstone
  softDeleteActivityByExternalId: typeof softDeleteActivityByExternalId
  upsertSyncedNote: typeof upsertSyncedNote
}

const defaultDeps: GravlProcessDeps = {
  adoptLegacyActivity,
  auditInfo,
  findActivityByExternalId,
  insertActivity,
  insertRawRecord,
  materializeSuperseded,
  restoreEmptyImportTombstone,
  restoreSetlessTombstone,
  softDeleteActivityByExternalId,
  upsertSyncedNote,
}

/** A Health Connect session round-tripped into Gravl from another app. */
export const isExternalWorkout = (workout: { type: string }): boolean =>
  workout.type.toLowerCase() === 'external'

const positive = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null

const isPositive = (value: number | null | undefined): boolean => positive(value) !== null

/**
 * Gravl stores the session it imported as one cardio pseudo-exercise whose set
 * holds duration and distance; a timed strength set (a plank) has no distance.
 */
const isLoggedSet = (set: GravlSet): boolean =>
  isPositive(set.reps) || isPositive(set.weight) || (isPositive(set.duration) && !isPositive(set.distance))

export const hasLoggedSets = (detail: GravlWorkoutDetail): boolean =>
  detail.exercises.some((exercise) => exercise.sets.some(isLoggedSet))

/** An external workout without its pseudo-exercise, so the imported session is only what was logged in Gravl. */
export const withLoggedExercises = (detail: GravlWorkoutDetail): GravlWorkoutDetail =>
  isExternalWorkout(detail)
    ? { ...detail, exercises: detail.exercises.filter((exercise) => exercise.sets.some(isLoggedSet)) }
    : detail

/** The list has no sets, and the pseudo-exercise alone counts as one exercise with no volume. */
export const mayCarryLoggedSets = (summary: Pick<GravlWorkoutSummary, 'exerciseCount' | 'volume'>): boolean =>
  summary.exerciseCount >= 2 || (summary.exerciseCount === 1 && isPositive(summary.volume))

/**
 * Only a workout holding at least one set carries anything Aurboda does not
 * already have; for an external one, the sets must have been logged in Gravl.
 */
export const isStrengthWorkout = (workout: GravlWorkoutSummary | GravlWorkoutDetail): boolean => {
  if ('exercises' in workout) {
    return isExternalWorkout(workout)
      ? hasLoggedSets(workout)
      : workout.exercises.some((exercise) => exercise.sets.length > 0)
  }
  return isExternalWorkout(workout) ? mayCarryLoggedSets(workout) : workout.exerciseCount > 0
}

const setKind = (setType: GravlSet['setType']): GravlSetKind => {
  switch (setType.toLowerCase()) {
    case 'warmup':
      return 'warmup'
    case 'dropset':
      return 'drop_set'
    case 'failure':
      return 'failure'
    default:
      return 'normal'
  }
}

const buildSet = (exercise: GravlWorkoutExercise, set: GravlSet): GravlSetRecord => ({
  distance: positive(set.distance),
  exercise: exercise.exerciseName,
  exercise_id: exercise.exerciseId,
  order: set.order,
  reps: positive(set.reps),
  rpe: positive(set.rpe),
  set_type: setKind(set.setType),
  time: positive(set.duration),
  weight: positive(set.weight) === null ? null : lbToKg(set.weight),
  ...(exercise.supersetId !== null && exercise.supersetId !== undefined
    ? { superset_id: exercise.supersetId }
    : {}),
})

export const buildGravlSets = (detail: GravlWorkoutDetail): GravlSetRecord[] =>
  detail.exercises.flatMap((exercise) =>
    [...exercise.sets].sort((a, b) => a.order - b.order).map((set) => buildSet(exercise, set)),
  )

const formatSeconds = (seconds: number): string => {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const formatSet = (set: GravlSetRecord): string => {
  const parts: string[] = []
  if (set.reps !== null && set.weight !== null) parts.push(`${set.reps}×${set.weight} kg`)
  else if (set.reps !== null) parts.push(`${set.reps} reps`)
  else if (set.weight !== null) parts.push(`${set.weight} kg`)
  if (set.time !== null) parts.push(formatSeconds(set.time))
  if (set.distance !== null) parts.push(`${set.distance} m`)
  if (parts.length === 0) parts.push('—')
  const flag =
    set.set_type === 'warmup'
      ? ' (w)'
      : set.set_type === 'drop_set'
        ? ' (drop)'
        : set.set_type === 'failure'
          ? ' (f)'
          : ''
  const rpe = set.rpe !== null ? ` @${set.rpe}` : ''
  return `${parts.join(' ')}${flag}${rpe}`
}

/**
 * Sets as readable text, one line per exercise in workout order:
 * `Bench Press: 8×60 kg (w), 8×80 kg, 6×80 kg @8`.
 */
export const formatGravlSetsNote = (detail: GravlWorkoutDetail): string => {
  const lines = detail.exercises
    .filter((exercise) => exercise.sets.length > 0)
    .map((exercise) => {
      const sets = [...exercise.sets]
        .sort((a, b) => a.order - b.order)
        .map((set) => formatSet(buildSet(exercise, set)))
      return `${exercise.exerciseName}: ${sets.join(', ')}`
    })
  const notes = detail.notes?.trim()
  return [notes, lines.join('\n')].filter((part) => part && part.length > 0).join('\n\n')
}

export const buildGravlActivity = (detail: GravlWorkoutDetail): Activity => {
  const sets = buildGravlSets(detail)
  return {
    activity_type: 'strength_training',
    data: {
      calories: positive(detail.calories) ?? undefined,
      exercise_count: detail.exercises.length,
      gravl_workout_id: detail.id.toLowerCase(),
      personal_record_count: detail.personalRecordCount,
      set_count: sets.length,
      sets,
      volume_kg: positive(detail.volume) === null ? 0 : lbToKg(detail.volume),
      workout_type: detail.type,
    },
    end_time: new Date(detail.endDate),
    external_id: gravlWorkoutExternalId(detail.id),
    source: 'gravl',
    start_time: new Date(detail.startDate),
    title: detail.name,
  }
}

export const buildGravlRawRecord = (detail: GravlWorkoutDetail): RawRecord => ({
  data: detail as unknown as Record<string, unknown>,
  external_id: gravlWorkoutExternalId(detail.id),
  record_type: 'gravl_workout',
  recorded_at: new Date(detail.startDate),
  source: 'gravl',
})

/**
 * `enriched`: a row that reached us another way (Health Connect) gained its
 * sets; `updated`: a row Gravl itself wrote earlier was re-processed;
 * `created`: nothing existed for the workout; `removed`: an External
 * round-trip without logged sets whose Health Connect copy was removed, or a
 * set-less workout whose empty import was retracted; `skipped`: an External
 * or set-less workout with no live row of ours, a workout whose row is
 * tombstoned (for any reason), or a rate-limit hold (enrichment).
 */
export type GravlProcessOutcome = 'enriched' | 'updated' | 'created' | 'removed' | 'skipped'

/**
 * The soft delete is a tombstone: `insertActivity` only updates rows with
 * `deleted_at IS NULL`, so a re-delivered Health Connect record neither
 * resurrects nor updates it. The note Gravl synced for the row goes with it;
 * comments the user wrote on it are left alone.
 */
const tombstoneGravlActivity = async (
  user: string,
  workoutId: string,
  existing: Activity,
  message: string,
  deps: GravlProcessDeps,
): Promise<void> => {
  await deps.softDeleteActivityByExternalId(user, 'gravl', gravlWorkoutExternalId(workoutId))
  if (existing.id) await deps.upsertSyncedNote(user, 'activity', existing.id, 'gravl', undefined)
  await deps.materializeSuperseded(user, existing.start_time)
  deps.auditInfo(user, 'sync', message, {
    activity_id: existing.id,
    workout_id: workoutId.toLowerCase(),
  })
}

/** Drop our own copy of a session Gravl merely re-exported. */
export const removeExternalGravlWorkout = async (
  user: string,
  workoutId: string,
  deps: GravlProcessDeps = defaultDeps,
): Promise<'removed' | 'skipped'> => {
  const existing = await deps.findActivityByExternalId(user, 'gravl', gravlWorkoutExternalId(workoutId))
  if (!existing) return 'skipped'

  await tombstoneGravlActivity(
    user,
    workoutId,
    existing,
    'Removed Health Connect copy of external Gravl workout',
    deps,
  )
  return 'removed'
}

/**
 * An empty `data.sets` is the footprint of the import. A Health Connect
 * session stored under the Gravl identity is a session the user did start,
 * with real timing and HR, and is kept: it has no `sets` key, or, if an
 * import before #1099 merged `sets: []` into it, it still carries the Health
 * Connect `data.metadata`.
 */
const isImportedWithoutSets = (activity: Activity): boolean => {
  const sets = activity.data?.sets
  return Array.isArray(sets) && sets.length === 0 && activity.data?.metadata === undefined
}

/** Drop the empty row an earlier run imported for a workout with no logged set. */
export const retractEmptyGravlImport = async (
  user: string,
  workoutId: string,
  deps: GravlProcessDeps = defaultDeps,
): Promise<'removed' | 'skipped'> => {
  const existing = await deps.findActivityByExternalId(user, 'gravl', gravlWorkoutExternalId(workoutId))
  if (!existing || !isImportedWithoutSets(existing)) return 'skipped'

  await tombstoneGravlActivity(
    user,
    workoutId,
    existing,
    'Retracted the empty import of a set-less Gravl workout',
    deps,
  )
  return 'removed'
}

/**
 * Store one Gravl workout. Claims the Health Connect copy of the session
 * (matched on Gravl's own `clientRecordId`) before upserting, so an existing
 * session is enriched in place and a new one created only when Health Connect
 * never delivered it. A retracted empty import is restored first, since the
 * workout now has sets, and so is the removed copy of an external workout
 * whose sets were logged since; any other tombstone blocks the write and the
 * workout is reported `skipped`.
 */
export const processGravlWorkout = async (
  user: string,
  detail: GravlWorkoutDetail,
  deps: GravlProcessDeps = defaultDeps,
): Promise<GravlProcessOutcome> => {
  const external = isExternalWorkout(detail)
  if (!isStrengthWorkout(detail)) {
    return external
      ? removeExternalGravlWorkout(user, detail.id, deps)
      : retractEmptyGravlImport(user, detail.id, deps)
  }

  const logged = withLoggedExercises(detail)
  const activity = buildGravlActivity(logged)
  const externalId = activity.external_id!

  const restored = external
    ? await deps.restoreSetlessTombstone(user, 'gravl', externalId)
    : await deps.restoreEmptyImportTombstone(user, 'gravl', externalId)

  await deps.insertRawRecord(user, buildGravlRawRecord(detail))

  await deps.adoptLegacyActivity(user, { external_id: externalId, source: 'gravl' }, [
    {
      client_record_id: `gravl-session-${detail.id}`,
      data_origin: GRAVL_HC_ORIGIN,
      kind: 'hc_client_record',
    },
    {
      client_record_id: `gravl-session-${detail.id.toLowerCase()}`,
      data_origin: GRAVL_HC_ORIGIN,
      kind: 'hc_client_record',
    },
  ])
  const existing = await deps.findActivityByExternalId(user, 'gravl', externalId)

  const id = (await deps.insertActivity(user, activity)) ?? existing?.id
  if (!id) return 'skipped'
  if (restored) await deps.materializeSuperseded(user, activity.start_time)
  await deps.upsertSyncedNote(
    user,
    'activity',
    id,
    'gravl',
    formatGravlSetsNote(logged),
    activity.start_time,
    activity.end_time,
  )

  if (!existing) return 'created'
  return Array.isArray(existing.data?.sets) ? 'updated' : 'enriched'
}
