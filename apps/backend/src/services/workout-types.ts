import { isExerciseActivityType } from '@aurboda/api-spec'

import { ancestorsByType, typeAndAncestors } from './correlations/type-family.ts'

export interface WorkoutTypeDefinition {
  name: string
  display_category: string
  parent_type?: string | null
}

/** Types that are, or descend from, `exercise`, a Health Connect exercise subtype or a type in the exercise category. */
export const workoutTypeNames = (definitions: readonly WorkoutTypeDefinition[]): string[] => {
  const ancestors = ancestorsByType(definitions)
  const categoryOf = new Map(definitions.map((d) => [d.name, d.display_category]))
  const isWorkoutItself = (type: string): boolean =>
    isExerciseActivityType(type) || categoryOf.get(type) === 'exercise'
  const names = new Set(['exercise'])
  for (const { name } of definitions) {
    if (typeAndAncestors(name, ancestors).some(isWorkoutItself)) names.add(name)
  }
  return [...names]
}
