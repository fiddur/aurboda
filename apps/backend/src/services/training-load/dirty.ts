import type { TrainingLoadSettings } from '@aurboda/api-spec'

import {
  getActivityTypeDefinitions,
  getEarliestActivityStart,
  mutateTrainingLoadSettings,
} from '../../db/index.ts'
import { auditError } from '../audit-log.ts'
import { workoutTypeNames, type WorkoutTypeDefinition } from '../workout-types.ts'
import { floorToHour } from './banister.ts'
import { withDirtyMark } from './state.ts'

/** The stored impulse hours from `from` on are recomputed on the next training load read. */
export const markImpulsesDirty = (user: string, from: Date): Promise<TrainingLoadSettings | undefined> =>
  mutateTrainingLoadSettings(user, (current) => withDirtyMark(current, from))

export interface WorkoutSession {
  activity_type: string
  start_time: Date
}

/** The hour of the earliest session of a workout type, if any. */
export const earliestWorkoutHour = (
  definitions: readonly WorkoutTypeDefinition[],
  sessions: readonly WorkoutSession[],
): Date | undefined => {
  const workoutTypes = new Set(workoutTypeNames(definitions))
  const starts = sessions.filter((s) => workoutTypes.has(s.activity_type)).map((s) => s.start_time.getTime())
  return starts.length > 0 ? floorToHour(new Date(Math.min(...starts))) : undefined
}

export interface WorkoutDirtyDeps {
  getActivityTypeDefinitions: (user: string) => Promise<WorkoutTypeDefinition[]>
  getEarliestActivityStart: (user: string, activityTypes: string[]) => Promise<Date | undefined>
  markImpulsesDirty: (user: string, from: Date) => Promise<unknown>
}

const defaultDeps: WorkoutDirtyDeps = {
  getActivityTypeDefinitions: (user) => getActivityTypeDefinitions(user),
  getEarliestActivityStart: (user, activityTypes) => getEarliestActivityStart(user, activityTypes),
  markImpulsesDirty,
}

/**
 * Marks the stored impulse hours dirty from the earliest workout among `sessions`. Pass a changed
 * session both as it was and as it is, so a retype out of a workout type counts. Best effort: a
 * failure is audited and never fails the change that called it.
 */
export const markWorkoutHoursDirty = async (
  user: string,
  sessions: readonly (WorkoutSession | null | undefined)[],
  deps: WorkoutDirtyDeps = defaultDeps,
): Promise<void> => {
  const present = sessions.filter((s): s is WorkoutSession => s !== null && s !== undefined)
  if (present.length === 0) return
  try {
    const from = earliestWorkoutHour(await deps.getActivityTypeDefinitions(user), present)
    if (from) await deps.markImpulsesDirty(user, from)
  } catch (err) {
    auditError(user, 'data', 'Failed to mark training load hours dirty', { error: String(err) })
  }
}

/**
 * The types whose sessions changed between workout and not-workout. With `moved`, the sessions of
 * `moved.from` became sessions of `moved.to` (a rename or a merge), so they count under `to`.
 */
export const workoutMembershipChanges = (
  before: readonly WorkoutTypeDefinition[],
  after: readonly WorkoutTypeDefinition[],
  moved?: { from: string; to: string },
): string[] => {
  const was = new Set(workoutTypeNames(before))
  const is = new Set(workoutTypeNames(after))
  const definedBefore = new Set(before.map((d) => d.name))
  const ownSessionsMoved = (name: string) =>
    name === moved?.from || (name === moved?.to && !definedBefore.has(name))
  const changed = new Set(
    [...was, ...is].filter((name) => !ownSessionsMoved(name) && was.has(name) !== is.has(name)),
  )
  if (moved && was.has(moved.from) !== is.has(moved.to)) changed.add(moved.to)
  return [...changed]
}

/**
 * Runs a change to the activity type definitions and marks the stored impulse hours dirty from the
 * earliest session of every type that it made a workout type or stopped being one. Best effort.
 */
export const trackWorkoutTypeChanges = async <T>(
  user: string,
  change: () => Promise<T>,
  moved?: { from: string; to: string },
  deps: WorkoutDirtyDeps = defaultDeps,
): Promise<T> => {
  const before = await Promise.resolve()
    .then(() => deps.getActivityTypeDefinitions(user))
    .catch(() => undefined)
  const result = await change()
  if (!Array.isArray(before)) return result
  try {
    const changed = workoutMembershipChanges(before, await deps.getActivityTypeDefinitions(user), moved)
    const earliest = changed.length > 0 ? await deps.getEarliestActivityStart(user, changed) : undefined
    if (earliest) await deps.markImpulsesDirty(user, floorToHour(earliest))
  } catch (err) {
    auditError(user, 'data', 'Failed to mark training load hours dirty', { error: String(err) })
  }
  return result
}
