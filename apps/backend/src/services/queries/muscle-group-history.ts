/**
 * Muscle group history of an activity type: when each muscle group was last trained, and one group's
 * totals, exercises and sessions over a period. Every measure counts a set by the exercise's
 * recruitment weight for the group (see `../muscle-group-measures.ts`).
 */

import {
  type ActivityMeasures,
  type ExerciseMuscleGroup,
  exerciseMuscleGroups,
  exerciseMuscleInfo,
  type MuscleGroupExercise,
  type MuscleGroupHistory,
  type MuscleGroupOverview,
  type MuscleGroupSession,
} from '@aurboda/api-spec'

import { expandActivityTypes, getActivities, getActivityTypeDefinitions } from '../../db/index.ts'
import { combineMeasures, listItems } from '../activity-measures.ts'
import { type ItemValueResult, resolveCatalogItemPath } from '../item-value-aliases.ts'
import {
  type ExerciseEntryResolver,
  measuresByMuscleGroup,
  type MuscleGroupContribution,
  muscleGroupContributions,
  roundMeasures,
} from '../muscle-group-measures.ts'
import { loadMuscleGroupResolvers } from '../muscle-group-resolvers.ts'
import { sessionId } from './activity-sessions.ts'

export interface ExerciseSession {
  activity_type: string
  id: string
  items: Record<string, unknown>[]
  start_time: Date
  title?: string
}

/** The exercise resolver of the type a session was logged as. */
export type ResolverOf = (activityType: string) => ExerciseEntryResolver

export interface Period {
  end: Date
  start: Date
}

const byStart = (sessions: ExerciseSession[]): ExerciseSession[] =>
  sessions.toSorted((a, b) => a.start_time.getTime() - b.start_time.getTime())

/** Per muscle group, the start of the latest session in which it got a weighted set count above 0. */
export const lastTrainedByGroup = (
  sessions: ExerciseSession[],
  key: string,
  resolverOf: ResolverOf,
): Map<ExerciseMuscleGroup, Date> => {
  const last = new Map<ExerciseMuscleGroup, Date>()
  for (const session of byStart(sessions)) {
    for (const bucket of measuresByMuscleGroup(session.items, key, resolverOf(session.activity_type))) {
      if (bucket.muscle_group !== null && (bucket.measures.set_count ?? 0) > 0) {
        last.set(bucket.muscle_group, session.start_time)
      }
    }
  }
  return last
}

export const muscleGroupOverview = (
  field: string,
  key: string,
  sessions: ExerciseSession[],
  resolverOf: ResolverOf,
): MuscleGroupOverview => {
  const last = lastTrainedByGroup(sessions, key, resolverOf)
  return {
    field,
    groups: exerciseMuscleGroups.map((group) => ({
      last_trained: last.get(group)?.toISOString() ?? null,
      muscle_group: group,
      name: exerciseMuscleInfo[group].name,
    })),
  }
}

interface ExerciseTally {
  catalog_key: string
  catalog_name: string
  last_time: Date
  period: ActivityMeasures[]
  session_count: number
  value: string
  weight: number
}

const inPeriod = (date: Date, { end, start }: Period): boolean =>
  date.getTime() >= start.getTime() && date.getTime() <= end.getTime()

const toExercise = (tally: ExerciseTally): MuscleGroupExercise => ({
  catalog_key: tally.catalog_key,
  catalog_name: tally.catalog_name,
  last_time: tally.last_time.toISOString(),
  measures: roundMeasures(combineMeasures(tally.period)),
  session_count: tally.session_count,
  value: tally.value,
  weight: tally.weight,
})

const tally = (
  exercises: Map<string, ExerciseTally>,
  contribution: MuscleGroupContribution,
  resolveEntry: ExerciseEntryResolver,
  start: Date,
  counted: boolean,
): void => {
  const entry = resolveEntry(contribution.value)
  if (!entry) return
  const previous = exercises.get(contribution.normalized)
  exercises.set(contribution.normalized, {
    catalog_key: entry.key,
    catalog_name: entry.name,
    last_time: start,
    period: counted ? [...(previous?.period ?? []), contribution.measures] : (previous?.period ?? []),
    session_count: (previous?.session_count ?? 0) + Number(counted),
    value: contribution.value,
    weight: contribution.weight,
  })
}

/**
 * One muscle group over a period: its weighted totals, every exercise ever logged that trains it
 * (most weighted sets in the period first, then the most recently done), and the sessions of the
 * period that trained it, newest first. `last_trained` is over all sessions.
 */
export const muscleGroupHistory = (
  field: string,
  key: string,
  group: ExerciseMuscleGroup,
  sessions: ExerciseSession[],
  resolverOf: ResolverOf,
  period: Period,
): MuscleGroupHistory => {
  const exercises = new Map<string, ExerciseTally>()
  const trained: MuscleGroupSession[] = []
  const totals: ActivityMeasures[] = []
  let lastTrained: Date | undefined
  for (const session of byStart(sessions)) {
    const resolveEntry = resolverOf(session.activity_type)
    const contributions = muscleGroupContributions(session.items, key, resolveEntry, group)
    if (contributions.length === 0) continue
    lastTrained = session.start_time
    const counted = inPeriod(session.start_time, period)
    for (const c of contributions) tally(exercises, c, resolveEntry, session.start_time, counted)
    if (!counted) continue
    const measures = combineMeasures(contributions.map((c) => c.measures))
    totals.push(measures)
    trained.push({
      activity_type: session.activity_type,
      exercises: contributions.map((c) => c.value),
      id: session.id,
      measures: roundMeasures(measures),
      start_time: session.start_time.toISOString(),
      ...(session.title !== undefined && { title: session.title }),
    })
  }
  return {
    end: period.end.toISOString(),
    exercises: [...exercises.values()]
      .map(toExercise)
      .toSorted(
        (a, b) =>
          (b.measures.set_count ?? 0) - (a.measures.set_count ?? 0) ||
          new Date(b.last_time).getTime() - new Date(a.last_time).getTime(),
      ),
    field,
    last_trained: lastTrained?.toISOString() ?? null,
    muscle_group: group,
    name: exerciseMuscleInfo[group].name,
    sessions: trained.toReversed(),
    start: period.start.toISOString(),
    totals: roundMeasures(combineMeasures(totals)),
  }
}

interface LoadedSessions {
  key: string
  resolverOf: ResolverOf
  sessions: ExerciseSession[]
}

/** Every session of the type and its descendants, with the exercise resolver of the type each was logged as. */
const loadSessions = async (
  user: string,
  activityType: string,
  path: string,
): Promise<ItemValueResult<LoadedSessions>> => {
  const resolved = await resolveCatalogItemPath(user, activityType, path)
  if (!resolved.success) return resolved
  const { key, list: field } = resolved.data
  const [definitions, types] = await Promise.all([
    getActivityTypeDefinitions(user),
    expandActivityTypes(user, [activityType]),
  ])
  const categoryMap = new Map(definitions.map((d) => [d.name, d.display_category]))
  const activities = await getActivities(
    user,
    types,
    new Date(0),
    new Date(),
    undefined,
    undefined,
    categoryMap,
  )
  const sessions = activities.flatMap((a): ExerciseSession[] =>
    a.id === undefined
      ? []
      : [
          {
            activity_type: a.activity_type,
            id: sessionId(a),
            items: listItems(a.data, field),
            start_time: a.start_time,
            ...(a.title && { title: a.title }),
          },
        ],
  )
  const resolvers = await loadMuscleGroupResolvers(
    user,
    activityType,
    sessions.map((s) => s.activity_type),
    [path],
  )
  return {
    data: { key, resolverOf: (type) => resolvers(type, path), sessions },
    success: true,
  }
}

export const queryMuscleGroupOverview = async (
  user: string,
  activityType: string,
  path: string,
): Promise<ItemValueResult<MuscleGroupOverview>> => {
  const loaded = await loadSessions(user, activityType, path)
  if (!loaded.success) return loaded
  const { key, resolverOf, sessions } = loaded.data
  return { data: muscleGroupOverview(path, key, sessions, resolverOf), success: true }
}

export const queryMuscleGroupHistory = async (
  user: string,
  activityType: string,
  path: string,
  group: ExerciseMuscleGroup,
  period: Period,
): Promise<ItemValueResult<MuscleGroupHistory>> => {
  const loaded = await loadSessions(user, activityType, path)
  if (!loaded.success) return loaded
  const { key, resolverOf, sessions } = loaded.data
  return { data: muscleGroupHistory(path, key, group, sessions, resolverOf, period), success: true }
}
