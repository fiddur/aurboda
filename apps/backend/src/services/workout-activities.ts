import type { ActivityType } from '../schema.ts'

import {
  getActivities,
  getActivityTypeDefinitions,
  getEarliestActivityStart,
  type MergedActivity,
} from '../db/index.ts'
import { workoutTypeNames } from './workout-types.ts'

/** Every workout type's sessions in the range, merged across sources like the activity lists. */
export const getWorkoutActivities = async (
  user: string,
  start: Date,
  end: Date,
): Promise<MergedActivity[]> => {
  const definitions = await getActivityTypeDefinitions(user)
  const categoryMap = new Map(definitions.map((d) => [d.name, d.display_category as string]))
  return getActivities(
    user,
    workoutTypeNames(definitions) as ActivityType[],
    start,
    end,
    undefined,
    undefined,
    categoryMap,
  )
}

export const getEarliestWorkoutStart = async (user: string): Promise<Date | undefined> =>
  getEarliestActivityStart(user, workoutTypeNames(await getActivityTypeDefinitions(user)))
