/**
 * The exercises a share with `include_exercises` carries: a session's list items grouped by the
 * type's first categorical item field (`sets.exercise` for strength training), each with its
 * sets, its measures and the records it set. One resolver feeds the Note content, the preview,
 * the owner card and the structured payload, so they agree.
 */
import type {
  ActivityItemHistory,
  ActivityMeasure,
  ActivityMeasures,
  DataSchemaDefinition,
  FeedStructuredExercise,
} from '@aurboda/api-spec'

import { activityMeasureUnits } from '@aurboda/api-spec'

import { getActivityTypeDefinition } from '../db/index.ts'
import { toWireKey } from './activitypub/quant-wire.ts'
import { queryActivityItemHistory } from './queries/activity-item-history.ts'

export interface SharedExerciseSet {
  reps?: number
  weight?: number
  time?: number
  set_type?: string
}

export interface SharedExercise {
  name: string
  sets: SharedExerciseSet[]
  measures: ActivityMeasures
  records: ActivityMeasure[]
}

export interface SharedExercisesDeps {
  getDataSchema: (user: string, activityType: string) => Promise<DataSchemaDefinition | null | undefined>
  queryItemHistory: (user: string, activityId: string, path: string) => Promise<ActivityItemHistory | null>
}

const defaultDeps: SharedExercisesDeps = {
  getDataSchema: async (user, activityType) =>
    (await getActivityTypeDefinition(user, activityType))?.data_schema,
  queryItemHistory: queryActivityItemHistory,
}

/** `list.item` for the schema's first categorical item field of a list field, e.g. `sets.exercise`. */
export const exerciseItemPath = (schema: DataSchemaDefinition | null | undefined): string | undefined => {
  for (const field of schema?.fields ?? []) {
    if (field.type !== 'list') continue
    const item = field.item_fields?.find((f) => f.is_categorical)
    if (item) return `${field.name}.${item.name}`
  }
  return undefined
}

const finite = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

export const toSharedSet = (item: Record<string, unknown>): SharedExerciseSet => {
  const set: SharedExerciseSet = {}
  const reps = finite(item.reps)
  const weight = finite(item.weight)
  const time = finite(item.time)
  if (reps !== undefined) set.reps = reps
  if (weight !== undefined) set.weight = weight
  if (time !== undefined) set.time = time
  if (typeof item.set_type === 'string' && item.set_type.trim() !== '') set.set_type = item.set_type.trim()
  return set
}

/**
 * The session's exercises, resolved over its merged view (a Garmin row whose sets live on the
 * overlapping Gravl row still finds them). Empty when the type has no categorical item field or
 * the session logged no items.
 */
export const resolveSharedExercises = async (
  user: string,
  activityId: string,
  activityType: string,
  deps: SharedExercisesDeps = defaultDeps,
): Promise<SharedExercise[]> => {
  const path = exerciseItemPath(await deps.getDataSchema(user, activityType))
  if (path === undefined) return []
  const history = await deps.queryItemHistory(user, `merged:${activityId}`, path)
  return (history?.groups ?? []).map((group) => ({
    measures: group.measures,
    name: group.value,
    records: group.records,
    sets: group.items.map(toSharedSet),
  }))
}

/** A post's shared exercises: none unless it opted in with `include_exercises`. */
export const resolvePostExercises = async (
  user: string,
  post: { activity_id?: string | null; include_exercises: boolean },
  activityType: string,
  deps: SharedExercisesDeps = defaultDeps,
): Promise<SharedExercise[]> =>
  post.include_exercises && post.activity_id
    ? resolveSharedExercises(user, post.activity_id, activityType, deps)
    : []

const formatSeconds = (seconds: number): string => {
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const SET_TYPE_FLAGS: Record<string, string> = { drop_set: ' (drop)', failure: ' (f)', warmup: ' (w)' }

/** One set in the Gravl note's notation: `8×80 kg (w)`, `12 reps`, `1:30`. */
export const formatExerciseSet = (set: SharedExerciseSet): string => {
  const parts: string[] = []
  if (set.reps !== undefined && set.weight !== undefined) parts.push(`${set.reps}×${set.weight} kg`)
  else if (set.reps !== undefined) parts.push(`${set.reps} reps`)
  else if (set.weight !== undefined) parts.push(`${set.weight} kg`)
  if (set.time !== undefined) parts.push(formatSeconds(set.time))
  if (parts.length === 0) parts.push('—')
  const flag = set.set_type === undefined ? '' : (SET_TYPE_FLAGS[set.set_type.toLowerCase()] ?? '')
  return `${parts.join(' ')}${flag}`
}

const RECORD_BADGES: Record<ActivityMeasure, string> = {
  e1rm: 'e1RM',
  max_reps: 'reps',
  max_time: 'hold',
  max_weight: 'weight',
  set_count: 'sets',
  total_reps: 'reps',
  volume: 'volume',
}

const kg = (value: number): string => `${Number(value.toFixed(1))} kg`

/** `Bench Press: 8×60 kg (w), 8×80 kg · e1RM 101.3 kg · volume 640 kg · PR e1RM` */
export const formatExerciseLine = (exercise: SharedExercise): string => {
  const parts = [`${exercise.name}: ${exercise.sets.map(formatExerciseSet).join(', ')}`]
  if (exercise.measures.e1rm !== undefined) parts.push(`e1RM ${kg(exercise.measures.e1rm)}`)
  if (exercise.measures.volume !== undefined) parts.push(`volume ${kg(exercise.measures.volume)}`)
  for (const record of exercise.records) parts.push(`PR ${RECORD_BADGES[record]}`)
  return parts.join(' · ')
}

const WIRE_UNITS: Record<string, string> = { s: 'seconds' }

/** The QuantPub wire form: lowerCamelCase keys, measures as metric objects. */
export const toStructuredExercise = (exercise: SharedExercise): FeedStructuredExercise => {
  const metrics = (Object.entries(exercise.measures) as [ActivityMeasure, number][]).map(
    ([measure, value]) => {
      const unit = activityMeasureUnits[measure]
      return { key: toWireKey(measure), value, ...(unit ? { unit: WIRE_UNITS[unit] ?? unit } : {}) }
    },
  )
  const structured: FeedStructuredExercise = {
    metrics,
    name: exercise.name,
    sets: exercise.sets.map(({ set_type, ...rest }) => ({
      ...rest,
      ...(set_type === undefined ? {} : { setType: set_type }),
    })),
  }
  if (exercise.records.length > 0) structured.records = exercise.records.map(toWireKey)
  return structured
}
