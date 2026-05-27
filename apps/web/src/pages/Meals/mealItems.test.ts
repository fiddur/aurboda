import { describe, expect, test } from 'vitest'

import { editItemsToBody, mealItemsToEdit, scaleNutrient } from './mealItems'

describe('editItemsToBody', () => {
  test('drops draft rows without food_item_id so autosave never implicitly creates items', () => {
    // The bug this guards against: every autosave keystroke without a
    // food_item_id was hitting backend findOrCreate and minting a new
    // canonical food item per partial name ("A", "As", "Ask"…).
    const body = editItemsToBody([
      { food_item_id: 'abc-123', name: 'Banana', quantity: 1, unit: 'piece' },
      { name: 'Asko' }, // user mid-type, no canonical pick yet
      { name: 'Askorbi' },
    ])
    expect(body).toEqual([{ food_item_id: 'abc-123', name: 'Banana', quantity: 1, unit: 'piece' }])
  })

  test('drops rows with food_item_id but empty/whitespace name', () => {
    expect(editItemsToBody([{ food_item_id: 'abc', name: '   ' }])).toEqual([])
  })

  test('keeps all rows that have both an id and a name', () => {
    const body = editItemsToBody([
      { food_item_id: 'a', name: 'A', quantity: 1 },
      { food_item_id: 'b', name: 'B', quantity: 2, unit: 'g' },
    ])
    expect(body).toHaveLength(2)
  })
})

describe('mealItemsToEdit', () => {
  test('handles undefined input as empty list', () => {
    expect(mealItemsToEdit(undefined)).toEqual([])
  })

  test('snapshots nutrient ref values for live scaling', () => {
    const [row] = mealItemsToEdit([{ calories: 100, food_item_id: 'a', name: 'Apple', quantity: 50 }])
    expect(row.ref).toEqual({
      calories: 100,
      carbs: undefined,
      fat: undefined,
      fiber: undefined,
      protein: undefined,
      quantity: 50,
    })
  })
})

describe('scaleNutrient', () => {
  test('scales linearly to current quantity', () => {
    expect(scaleNutrient({ calories: 100, quantity: 100 }, 'calories', 250)).toBe(250)
  })

  test('returns base value when reference quantity is 0 or missing', () => {
    expect(scaleNutrient({ calories: 100, quantity: 0 }, 'calories', 50)).toBe(100)
    expect(scaleNutrient({ calories: 100 }, 'calories', 50)).toBe(100)
  })

  test('returns undefined when ref or field is missing', () => {
    expect(scaleNutrient(undefined, 'calories', 50)).toBeUndefined()
    expect(scaleNutrient({ quantity: 100 }, 'calories', 50)).toBeUndefined()
  })

  test('portion path: scales by count × base_equivalent / canonical default_quantity', () => {
    // 100 g chocolate base, 500 kcal/100 g. "3 ruta" where ruta = 3.4 g →
    // 500 × 3 × 3.4 / 100 = 51 kcal.
    const canonicalRef = { calories: 500, quantity: 100 }
    expect(
      scaleNutrient(canonicalRef, 'calories', undefined, { count: 3, base_equivalent: 3.4 }),
    ).toBeCloseTo(51, 2)
  })

  test('portion path ignores currentQuantity in favor of portion math', () => {
    // currentQuantity should be irrelevant when portionScale is supplied —
    // the bug this guards: pre-fix the formula used the row's `quantity`
    // (which for portion-pinned rows is portion_count × label_quantity,
    // not canonical default_quantity), causing wrong-scale display on load.
    const canonicalRef = { calories: 500, quantity: 100 }
    const withQty = scaleNutrient(canonicalRef, 'calories', 9999, { count: 1, base_equivalent: 10 })
    const withoutQty = scaleNutrient(canonicalRef, 'calories', undefined, { count: 1, base_equivalent: 10 })
    expect(withQty).toBe(withoutQty)
    expect(withQty).toBe(50) // 500 × 1 × 10 / 100
  })
})

describe('mealItemsToEdit + editItemsToBody portion round-trip', () => {
  test('portion-pinned input survives the load → save cycle', () => {
    // The meal response carries food_item_portion_id + portion_count for
    // portion-pinned rows. mealItemsToEdit must preserve both so that
    // editItemsToBody emits the portion-path payload on save.
    const [row] = mealItemsToEdit([
      {
        food_item_id: 'food-a',
        food_item_portion_id: 'portion-a',
        portion_count: 3,
        name: 'Choklad',
        quantity: 3, // server stored count × label_quantity
        unit: 'ruta',
        calories: 51,
      },
    ])
    expect(row.food_item_portion_id).toBe('portion-a')
    expect(row.portion_count).toBe(3)

    const body = editItemsToBody([row])
    expect(body).toHaveLength(1)
    expect(body![0]).toEqual({
      food_item_id: 'food-a',
      food_item_portion_id: 'portion-a',
      portion_count: 3,
      name: 'Choklad',
    })
  })

  test('legacy row (no portion fields) round-trips through the legacy payload', () => {
    const [row] = mealItemsToEdit([
      { food_item_id: 'food-b', name: 'B', quantity: 200, unit: 'g', calories: 80 },
    ])
    expect(row.food_item_portion_id).toBeUndefined()
    expect(row.portion_count).toBeUndefined()

    const body = editItemsToBody([row])
    expect(body![0]).toEqual({ food_item_id: 'food-b', name: 'B', quantity: 200, unit: 'g' })
  })
})
