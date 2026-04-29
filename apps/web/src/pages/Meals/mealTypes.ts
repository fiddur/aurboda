/**
 * Shared meal-type constants + the dropdown sentinel logic.
 * Pulled out of MealDetail so MealDetail and the meals overview agree
 * on the default custom value by reference, and so the dropdown logic
 * is independently unit-testable.
 */

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'drink'] as const

export type KnownMealType = (typeof MEAL_TYPES)[number]

/**
 * The value committed when the user selects "Other..." while not already
 * in custom mode. It's a real string the backend will accept; the editor
 * input below the dropdown lets the user refine it from there.
 */
export const DEFAULT_CUSTOM_TYPE = 'other'

/** Sentinel value used by the <select> for "Other..." */
export const CUSTOM_SENTINEL = '__custom'

/**
 * Decide what the editor's onChange should fire given the current value
 * and the option the user just picked from the dropdown.
 *
 * Returns the new value to commit, or `null` when the selection is a
 * no-op (picking "Other..." while already in custom mode — keeping the
 * user's existing custom string instead of clobbering it).
 */
export const resolveMealTypeChange = (current: string, selected: string): string | null => {
  if (selected !== CUSTOM_SENTINEL) return selected
  // Already in custom mode — picking "Other..." again shouldn't replace
  // a meaningful custom value (e.g. "midnight snack") with the default.
  if (!(MEAL_TYPES as readonly string[]).includes(current)) return null
  return DEFAULT_CUSTOM_TYPE
}
