/**
 * Gravl workout → activity mapping (#1042).
 *
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
 */

import type { Activity, RawRecord } from '../../db/types.ts'
import type { GravlSet, GravlWorkoutDetail, GravlWorkoutExercise, GravlWorkoutSummary } from './types.ts'

import {
  adoptLegacyActivity,
  findActivityByExternalId,
  insertActivity,
  insertRawRecord,
} from '../../db/index.ts'
import { upsertSyncedNote } from '../../db/notes.ts'
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
  findActivityByExternalId: typeof findActivityByExternalId
  insertActivity: typeof insertActivity
  insertRawRecord: typeof insertRawRecord
  upsertSyncedNote: typeof upsertSyncedNote
}

const defaultDeps: GravlProcessDeps = {
  adoptLegacyActivity,
  findActivityByExternalId,
  insertActivity,
  insertRawRecord,
  upsertSyncedNote,
}

/** Health Connect sessions round-tripped into Gravl from other apps carry no sets and must not be imported. */
export const isExternalWorkout = (workout: Pick<GravlWorkoutSummary, 'type'>): boolean =>
  workout.type === 'External'

const setKind = (setType: GravlSet['setType']): GravlSetKind => {
  switch (setType) {
    case 'Warmup':
      return 'warmup'
    case 'DropSet':
      return 'drop_set'
    case 'Failure':
      return 'failure'
    default:
      return 'normal'
  }
}

const positive = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null

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

export type GravlProcessOutcome = 'enriched' | 'created' | 'skipped'

/**
 * Store one Gravl workout. Claims the Health Connect copy of the session
 * (matched on Gravl's own `clientRecordId`) before upserting, so an existing
 * session is enriched in place and a new one created only when Health Connect
 * never delivered it.
 */
export const processGravlWorkout = async (
  user: string,
  detail: GravlWorkoutDetail,
  deps: GravlProcessDeps = defaultDeps,
): Promise<GravlProcessOutcome> => {
  if (isExternalWorkout(detail)) return 'skipped'

  const activity = buildGravlActivity(detail)
  const externalId = activity.external_id!

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
  if (id) {
    await deps.upsertSyncedNote(
      user,
      'activity',
      id,
      'gravl',
      formatGravlSetsNote(detail),
      activity.start_time,
      activity.end_time,
    )
  }

  return existing ? 'enriched' : 'created'
}
