import {
  type CreateStrengthPlanBody,
  EXERCISE_PRIMARY_MUSCLE_WEIGHT,
  type ExerciseMuscleGroup,
  type StoredExerciseCatalog,
  type StoredExerciseCatalogEntry,
  type StrengthPlan,
  type StrengthPlanSet,
  type StrengthPlansQuery,
  type UpdateStrengthPlanBody,
} from '@aurboda/api-spec'

import type { StrengthPlanPatch, StrengthPlanRecord, StrengthPlanSessionRecord } from '../db/index.ts'
import type { ExerciseEntryResolver } from './muscle-group-measures.ts'

import {
  createStrengthPlan,
  deleteStrengthPlan,
  getStrengthPlan,
  listStrengthPlans,
  listStrengthPlanSessions,
  updateStrengthPlan,
} from '../db/index.ts'
import { UUID_RE } from '../utils.ts'
import { getExerciseByKey, loadExerciseCatalog } from './exercise-catalog.ts'
import { loadExerciseEntryResolver } from './item-value-identities.ts'
import { muscleGroupWeights } from './muscle-group-measures.ts'

export type StrengthPlanResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: 400 | 404 }

export interface StrengthPlanStore {
  create: typeof createStrengthPlan
  delete: typeof deleteStrengthPlan
  get: typeof getStrengthPlan
  list: typeof listStrengthPlans
  sessions: typeof listStrengthPlanSessions
  update: typeof updateStrengthPlan
}

// Bound lazily, so a test that mocks the db module without these functions can still load this one.
export const dbStrengthPlanStore: StrengthPlanStore = {
  create: (...args) => createStrengthPlan(...args),
  delete: (...args) => deleteStrengthPlan(...args),
  get: (...args) => getStrengthPlan(...args),
  list: (...args) => listStrengthPlans(...args),
  sessions: (...args) => listStrengthPlanSessions(...args),
  update: (...args) => updateStrengthPlan(...args),
}

export const PLAN_NOT_FOUND = 'Plan not found'

const notFound = { error: PLAN_NOT_FOUND, status: 404, success: false } as const

/** The first planned set whose `exercise_key` is not a key of the catalogue, as an error naming it. */
export const unknownExerciseKey = (
  sets: StrengthPlanSet[],
  catalog: StoredExerciseCatalog,
): string | null => {
  for (const [i, set] of sets.entries()) {
    if (set.exercise_key !== undefined && !getExerciseByKey(catalog, set.exercise_key)) {
      return `sets[${i}].exercise_key: unknown exercise catalogue key "${set.exercise_key}"`
    }
  }
  return null
}

export type PlanSetEntry = (set: StrengthPlanSet) => StoredExerciseCatalogEntry | undefined

/** A set's catalogue entry: by its `exercise_key`, else by its name through the user's resolver. */
export const planSetEntry =
  (catalog: StoredExerciseCatalog, byName: ExerciseEntryResolver | undefined): PlanSetEntry =>
  (set) =>
    (set.exercise_key !== undefined ? getExerciseByKey(catalog, set.exercise_key) : undefined) ??
    byName?.(set.exercise)

export const planMuscleGroups = (sets: StrengthPlanSet[], entryOf: PlanSetEntry): ExerciseMuscleGroup[] => {
  const groups = new Set<ExerciseMuscleGroup>()
  for (const set of sets) {
    const entry = entryOf(set)
    if (!entry) continue
    for (const [group, weight] of Object.entries(muscleGroupWeights(entry)) as [
      ExerciseMuscleGroup,
      number,
    ][]) {
      if (weight >= EXERCISE_PRIMARY_MUSCLE_WEIGHT) groups.add(group)
    }
  }
  return [...groups]
}

export const serializeStrengthPlan = (
  record: StrengthPlanRecord,
  sessions: StrengthPlanSessionRecord[] = [],
  entryOf: PlanSetEntry = () => undefined,
): StrengthPlan => ({
  created_at: record.created_at.toISOString(),
  id: record.id,
  muscle_groups: planMuscleGroups(record.sets, entryOf),
  name: record.name,
  note: record.note,
  planned_for: record.planned_for,
  sessions: sessions.map((s) => ({ activity_id: s.activity_id, start_time: s.start_time.toISOString() })),
  sets: record.sets,
  updated_at: record.updated_at.toISOString(),
})

const byCreated = (a: StrengthPlan, b: StrengthPlan): number =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** Plans with a day first, earliest day first; then routines by name, case-insensitive; ties by creation. */
export const compareStrengthPlans = (a: StrengthPlan, b: StrengthPlan): number => {
  if (a.planned_for !== null && b.planned_for !== null) {
    if (a.planned_for !== b.planned_for) return a.planned_for < b.planned_for ? -1 : 1
    return byCreated(a, b)
  }
  if (a.planned_for !== null) return -1
  if (b.planned_for !== null) return 1
  const nameOrder = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  return nameOrder !== 0 ? nameOrder : byCreated(a, b)
}

/** `open`: routines, and the plans with a day that no session has been started from yet. */
export const isOpenStrengthPlan = (plan: StrengthPlan): boolean =>
  plan.planned_for === null || plan.sessions.length === 0

export const selectStrengthPlans = (
  plans: StrengthPlan[],
  status: StrengthPlansQuery['status'],
): StrengthPlan[] =>
  (status === 'all' ? plans : plans.filter(isOpenStrengthPlan)).toSorted(compareStrengthPlans)

export const strengthPlanPatch = (body: UpdateStrengthPlanBody): StrengthPlanPatch | null => {
  const patch: StrengthPlanPatch = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.note !== undefined) patch.note = body.note || null
  if (body.planned_for !== undefined) patch.planned_for = body.planned_for
  if (body.sets !== undefined) patch.sets = body.sets
  return Object.keys(patch).length === 0 ? null : patch
}

export type ExerciseNameResolverLoader = (user: string) => Promise<ExerciseEntryResolver | undefined>

const loadStrengthExerciseResolver: ExerciseNameResolverLoader = (user) =>
  loadExerciseEntryResolver(user, 'strength_training', 'sets.exercise')

export const createStrengthPlansService = (
  store: StrengthPlanStore = dbStrengthPlanStore,
  catalog: () => StoredExerciseCatalog = loadExerciseCatalog,
  nameResolver: ExerciseNameResolverLoader = loadStrengthExerciseResolver,
) => {
  const entryResolver = async (user: string): Promise<PlanSetEntry> =>
    planSetEntry(catalog(), await nameResolver(user))

  const withSessions = async (user: string, record: StrengthPlanRecord): Promise<StrengthPlan> => {
    const [sessions, entryOf] = await Promise.all([store.sessions(user, [record.id]), entryResolver(user)])
    return serializeStrengthPlan(record, sessions.get(record.id), entryOf)
  }

  const list = async (user: string, status: StrengthPlansQuery['status']): Promise<StrengthPlan[]> => {
    const [records, sessions, entryOf] = await Promise.all([
      store.list(user),
      store.sessions(user),
      entryResolver(user),
    ])
    return selectStrengthPlans(
      records.map((record) => serializeStrengthPlan(record, sessions.get(record.id), entryOf)),
      status,
    )
  }

  const get = async (user: string, id: string): Promise<StrengthPlanResult<StrengthPlan>> => {
    const record = UUID_RE.test(id) ? await store.get(user, id) : null
    if (!record) return notFound
    return { data: await withSessions(user, record), success: true }
  }

  const create = async (
    user: string,
    body: CreateStrengthPlanBody,
  ): Promise<StrengthPlanResult<StrengthPlan>> => {
    const unknownKey = unknownExerciseKey(body.sets, catalog())
    if (unknownKey) return { error: unknownKey, status: 400, success: false }
    const record = await store.create(user, {
      name: body.name,
      note: body.note || null,
      planned_for: body.planned_for ?? null,
      sets: body.sets,
    })
    return { data: serializeStrengthPlan(record, [], await entryResolver(user)), success: true }
  }

  const update = async (
    user: string,
    id: string,
    body: UpdateStrengthPlanBody,
  ): Promise<StrengthPlanResult<StrengthPlan>> => {
    const patch = strengthPlanPatch(body)
    if (!patch) return { error: 'Nothing to update', status: 400, success: false }
    const unknownKey = patch.sets ? unknownExerciseKey(patch.sets, catalog()) : null
    if (unknownKey) return { error: unknownKey, status: 400, success: false }
    const record = UUID_RE.test(id) ? await store.update(user, id, patch) : null
    if (!record) return notFound
    return { data: await withSessions(user, record), success: true }
  }

  const remove = async (user: string, id: string): Promise<StrengthPlanResult<null>> =>
    UUID_RE.test(id) && (await store.delete(user, id)) ? { data: null, success: true } : notFound

  return { create, get, list, remove, update }
}

export type StrengthPlansService = ReturnType<typeof createStrengthPlansService>
