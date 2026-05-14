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
})
