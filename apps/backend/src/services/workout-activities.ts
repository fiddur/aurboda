import type { ActivityTypeDefinition } from '@aurboda/api-spec'

import type { ActivityType } from '../schema.ts'

import {
  CROSS_MERGEABLE_CATEGORIES,
  getActivities,
  getActivityTypeDefinitions,
  getEarliestActivityStart,
  type MergedActivity,
} from '../db/index.ts'
import { workoutTypeNames } from './workout-types.ts'

/**
 * Every workout type's sessions in the range, merged across sources like the activity lists.
 * Meditation and wellness sessions are read along because one can win the merge over a synced
 * workout, and are dropped afterwards.
 */
export const getWorkoutActivities = async (
  user: string,
  start: Date,
  end: Date,
  definitions?: ActivityTypeDefinition[],
): Promise<MergedActivity[]> => {
  definitions ??= await getActivityTypeDefinitions(user)
  const categoryMap = new Map(definitions.map((d) => [d.name, d.display_category as string]))
  const workoutTypes = new Set(workoutTypeNames(definitions))
  const mergePartners = definitions
    .filter((d) => CROSS_MERGEABLE_CATEGORIES.has(d.display_category))
    .map((d) => d.name)
  const merged = await getActivities(
    user,
    [...new Set([...workoutTypes, ...mergePartners])] as ActivityType[],
    start,
    end,
    undefined,
    undefined,
    categoryMap,
  )
  return merged.filter((a) => workoutTypes.has(a.activity_type))
}

export const getEarliestWorkoutStart = async (
  user: string,
  definitions?: ActivityTypeDefinition[],
): Promise<Date | undefined> =>
  getEarliestActivityStart(user, workoutTypeNames(definitions ?? (await getActivityTypeDefinitions(user))))
