import { type DeletedRuleActivities, deleteRuleActivities } from '../db/index.ts'
import { markWorkoutHoursDirty, type WorkoutSession } from './training-load/dirty.ts'

export interface RemoveRuleActivitiesDeps {
  deleteRuleActivities: (user: string, ruleId: string) => Promise<DeletedRuleActivities>
  markWorkoutHoursDirty: (user: string, sessions: readonly WorkoutSession[]) => Promise<void>
}

const defaultDeps: RemoveRuleActivitiesDeps = { deleteRuleActivities, markWorkoutHoursDirty }

/** Deletes the activities a deduction rule created and marks the training load hours of any workouts among them dirty. */
export const removeRuleActivities = async (
  user: string,
  ruleId: string,
  deps: RemoveRuleActivitiesDeps = defaultDeps,
): Promise<number> => {
  const { count, earliest_by_type } = await deps.deleteRuleActivities(user, ruleId)
  if (count > 0) await deps.markWorkoutHoursDirty(user, earliest_by_type)
  return count
}
