import { describe, expect, test } from 'vitest'

import type { Meal } from '../../state/api'

import { aggregateDayNutrients } from './dayNutrients'

const makeMeal = (partial: Partial<Meal>): Meal => ({ time: new Date(0), ...partial })

describe('aggregateDayNutrients', () => {
  test('sums macros across meals when meal-level and aggregate agree', () => {
    const meals = [
      makeMeal({ calories: 300, protein: 10, nutrients: { calories: 300, protein: 10 } }),
      makeMeal({ calories: 200, protein: 5, nutrients: { calories: 200, protein: 5 } }),
    ]
    const totals = aggregateDayNutrients(meals)
    expect(totals.calories).toBe(500)
    expect(totals.protein).toBe(15)
  })

  test('uses the meal-level macro when a food item lacks per-item nutrition (override > aggregate)', () => {
    // Dinner: curry food item has no per-item calories, so nutrients only
    // captures the rice (122.82). The meal-level estimate (760) is the truth.
    const meals = [
      makeMeal({
        calories: 760,
        nutrient_data_incomplete: true,
        nutrients: { calories: 122.82 },
      }),
    ]
    expect(aggregateDayNutrients(meals).calories).toBe(760)
  })

  test('reproduces the real day: card-level total, not the understated aggregate', () => {
    const meals = [
      makeMeal({ calories: 327.72, nutrients: { calories: 327.72 } }), // breakfast
      makeMeal({ calories: 721.08, nutrients: { calories: 721.08 } }), // lunch
      makeMeal({ calories: 22, nutrients: { calories: 22 } }), // supplements
      makeMeal({ calories: 760, nutrient_data_incomplete: true, nutrients: { calories: 122.82 } }), // dinner
      makeMeal({ calories: 266, nutrients: { calories: 266 } }), // snack
      makeMeal({ calories: 193.8, nutrients: { calories: 193.8 } }), // snack
    ]
    // Old behaviour summed nutrients → 1653.42. Cards (meal.calories) sum to 2290.6.
    expect(aggregateDayNutrients(meals).calories).toBe(2290.6)
  })

  test('micronutrients (no meal-level override) stay summed from the aggregate', () => {
    const meals = [
      makeMeal({
        calories: 760,
        nutrient_data_incomplete: true,
        nutrients: { calories: 122.82, sodium: 234.96 },
      }),
      makeMeal({ calories: 266, nutrients: { calories: 266, sodium: 56 } }),
    ]
    const totals = aggregateDayNutrients(meals)
    expect(totals.calories).toBe(1026)
    expect(totals.sodium).toBe(290.96)
  })

  test('falls back to the aggregate when no meal-level macro is set', () => {
    const meals = [makeMeal({ nutrients: { calories: 122.82 } })]
    expect(aggregateDayNutrients(meals).calories).toBe(122.82)
  })

  test('skips meals without nutrients', () => {
    const meals = [makeMeal({ calories: 100 }), makeMeal({ calories: 50, nutrients: { calories: 50 } })]
    expect(aggregateDayNutrients(meals).calories).toBe(50)
  })

  test('honours a meal-level override that is lower than the aggregate', () => {
    const meals = [makeMeal({ calories: 80, nutrients: { calories: 120 } })]
    expect(aggregateDayNutrients(meals).calories).toBe(80)
  })
})
