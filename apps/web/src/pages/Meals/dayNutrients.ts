import type { Meal } from '../../state/api'

/**
 * Macro fields that live both on the meal row (manual-override-aware, shown
 * on each meal card via `meal.calories` etc.) and inside `meal.nutrients`
 * (aggregated from per-food-item data). When a food item lacks per-item
 * nutrition, `meal.nutrients` understates the meal, but the meal-level field
 * still reflects the manual override entered for the meal as a whole.
 */
const MEAL_MACRO_FIELDS = ['calories', 'protein', 'carbs', 'fat', 'fiber'] as const

/**
 * Aggregate nutrients across all meals for the day.
 *
 * For the macro fields the meal-level value wins over the per-food-item
 * aggregate, so the day total stays consistent with each meal card. This
 * matters when a meal is flagged `nutrient_data_incomplete`: a food item with
 * no nutrition data contributes 0 to `meal.nutrients`, but the user's
 * meal-level override (e.g. an estimated 760 kcal for a home-cooked dish)
 * should still count toward the day total. Micronutrients have no meal-level
 * override and remain summed from `meal.nutrients` (still understated, which
 * the "totals may be understated" notice covers).
 */
export const aggregateDayNutrients = (meals: Meal[]): Record<string, number> => {
  const totals: Record<string, number> = {}
  for (const meal of meals) {
    const { nutrients } = meal
    if (nutrients) {
      for (const [key, val] of Object.entries(nutrients)) {
        if (typeof val === 'number' && val > 0) totals[key] = (totals[key] ?? 0) + val
      }
    }
    // Swap in the meal-level macro where it differs from the aggregate — or
    // add it outright when the meal has no `nutrients` object at all (a
    // manually logged meal with no itemized food items still shows its
    // calories on the card, so it must count toward the day total too).
    for (const key of MEAL_MACRO_FIELDS) {
      const mealVal = meal[key]
      if (typeof mealVal !== 'number') continue
      const nutrientVal = nutrients?.[key]
      if (mealVal === nutrientVal) continue
      totals[key] = (totals[key] ?? 0) - (typeof nutrientVal === 'number' ? nutrientVal : 0) + mealVal
    }
  }
  for (const key of Object.keys(totals)) totals[key] = Math.round(totals[key] * 100) / 100
  return totals
}
