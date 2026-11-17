import type { ExerciseEntryResolver } from './muscle-group-measures.ts'

import { loadExerciseEntryResolver } from './item-value-identities.ts'

/**
 * Per activity type and muscle-group item path, the exercise resolver of that type's own definition,
 * else of the requested pattern's: sessions of a parent type (or several types) resolve their sets by
 * the catalogue field of the type they were logged as.
 */
export const loadMuscleGroupResolvers = async (
  user: string,
  pattern: string,
  activityTypes: string[],
  paths: string[],
): Promise<(activityType: string, path: string) => ExerciseEntryResolver> => {
  const keyOf = (activityType: string, path: string) => `${activityType}\u0000${path}`
  const loaded = new Map(
    await Promise.all(
      [...new Set([pattern, ...activityTypes])].flatMap((activityType) =>
        paths.map(
          async (path) =>
            [keyOf(activityType, path), await loadExerciseEntryResolver(user, activityType, path)] as const,
        ),
      ),
    ),
  )
  return (activityType, path) =>
    loaded.get(keyOf(activityType, path)) ?? loaded.get(keyOf(pattern, path)) ?? (() => undefined)
}
