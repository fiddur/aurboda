/**
 * Integration tests for the meals service.
 *
 * Covers the canonical-food + scaling pipeline: add_meal/update_meal must
 * snapshot canonical nutrient values into meal_food_items scaled by quantity,
 * and the meal's macro columns must auto-fill from the snapshot sum unless
 * the caller explicitly provided meal-level macros.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { setIngredients } from '../db/food-item-ingredients.ts'
import { insertFoodItemPortion } from '../db/food-item-portions.ts'
import { updateFoodItem, upsertFoodItem } from '../db/food-items.ts'
import { getMealFoodItemsBatch } from '../db/meal-food-items.ts'
import { getMealById, getMeals as dbGetMeals } from '../db/meals.ts'
import { insertSensitivityFlag, setFoodItemSensitivities } from '../db/sensitivities.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { addMeal, getMeal, queryFrequentMeals, resnapshotMealsForFoodItem, updateMealById } from './meals.ts'

const CONTAINER_TIMEOUT = 120_000

describe('Meals service integration tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('scales canonical nutrients by quantity into junction snapshots', async () => {
    const user = getTestUser()
    const canonical = await upsertFoodItem(user, {
      calories: 200,
      carbs: 40,
      default_quantity: 100,
      default_unit: 'g',
      fat: 2,
      fiber: 5,
      name: 'Rye bread',
      protein: 8,
    })

    const result = await addMeal(user, {
      food_items: [{ food_item_id: canonical.id, name: 'Rye bread', quantity: 500, unit: 'g' }],
      time: '2025-06-15T08:00:00Z',
    })

    expect(result.success).toBe(true)
    const mealId = result.data!.id

    const links = (await getMealFoodItemsBatch(user, [mealId])).get(mealId) ?? []
    expect(links).toHaveLength(1)
    expect(links[0].calories).toBe(1000)
    expect(links[0].protein).toBe(40)
    expect(links[0].carbs).toBe(200)
    expect(links[0].fat).toBe(10)
    expect(links[0].fiber).toBe(25)
  })

  test('auto-fills meal-level macros from junction sum when not provided', async () => {
    const user = getTestUser()
    const bread = await upsertFoodItem(user, {
      calories: 200,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Rye bread',
      protein: 8,
    })
    const pb = await upsertFoodItem(user, {
      calories: 600,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Peanut butter',
      protein: 25,
    })

    const result = await addMeal(user, {
      food_items: [
        { food_item_id: bread.id, name: 'Rye bread', quantity: 50, unit: 'g' },
        { food_item_id: pb.id, name: 'Peanut butter', quantity: 30, unit: 'g' },
      ],
      time: '2025-06-15T08:00:00Z',
    })

    const meal = await getMealById(user, result.data!.id)
    expect(meal!.calories).toBe(280)
    expect(meal!.protein).toBe(11.5)
  })

  test('honors explicit meal-level macros when caller provides them', async () => {
    const user = getTestUser()
    const bread = await upsertFoodItem(user, {
      calories: 200,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Rye bread',
      protein: 8,
    })

    const result = await addMeal(user, {
      calories: 1234,
      food_items: [{ food_item_id: bread.id, name: 'Rye bread', quantity: 100, unit: 'g' }],
      time: '2025-06-15T08:00:00Z',
    })

    const meal = await getMealById(user, result.data!.id)
    expect(meal!.calories).toBe(1234)
    expect(meal!.protein).toBe(8)
  })

  test('rescales snapshots when a meal is updated with a new quantity', async () => {
    const user = getTestUser()
    const bread = await upsertFoodItem(user, {
      calories: 200,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Rye bread',
      protein: 8,
    })

    const created = await addMeal(user, {
      food_items: [{ food_item_id: bread.id, name: 'Rye bread', quantity: 100, unit: 'g' }],
      time: '2025-06-15T08:00:00Z',
    })
    const mealId = created.data!.id

    const updated = await updateMealById(user, mealId, {
      food_items: [{ food_item_id: bread.id, name: 'Rye bread', quantity: 500, unit: 'g' }],
    })

    expect(updated.success).toBe(true)
    const links = (await getMealFoodItemsBatch(user, [mealId])).get(mealId) ?? []
    expect(links[0].calories).toBe(1000)
    expect(links[0].protein).toBe(40)

    const meal = await getMealById(user, mealId)
    expect(meal!.calories).toBe(1000)
  })

  describe('resnapshotMealsForFoodItem', () => {
    test('refreshes composite snapshots from current derived totals; leaves other items alone', async () => {
      const user = getTestUser()
      // Two simple atomic ingredients.
      const coffee = await upsertFoodItem(user, {
        calories: 2,
        default_quantity: 100,
        default_unit: 'g',
        name: 'Coffee',
        water: 99,
      })
      const oil = await upsertFoodItem(user, {
        calories: 880,
        default_quantity: 100,
        default_unit: 'g',
        fat: 100,
        name: 'Coconut oil',
      })
      // A composite parent with stale row columns.
      const recipe = await upsertFoodItem(user, {
        calories: 999, // stale leftover
        default_quantity: 1,
        default_unit: 'recipe',
        fiber: 99,
        name: 'Fat coffee',
      })
      await setIngredients(user, recipe.id, [
        { ingredient_food_item_id: coffee.id, quantity: 500, sort_order: 0, unit: 'g' },
        { ingredient_food_item_id: oil.id, quantity: 15, sort_order: 1, unit: 'g' },
      ])
      // An unrelated food item (must be left untouched in the meal).
      const banana = await upsertFoodItem(user, {
        calories: 89,
        default_quantity: 100,
        default_unit: 'g',
        name: 'Banana',
      })

      // Log a meal with the recipe + banana.
      const created = await addMeal(user, {
        food_items: [
          { food_item_id: recipe.id, name: 'Fat coffee', quantity: 1, unit: 'recipe' },
          { food_item_id: banana.id, name: 'Banana', quantity: 100, unit: 'g' },
        ],
        time: '2025-06-15T08:00:00Z',
      })
      const mealId = created.data!.id

      // Sanity: snapshot already uses derived totals (because syncFoodItemsToJunction
      // fetches detail for composites). 500 g × 0.02 + 15 g × 8.8 = 10 + 132 = 142 kcal.
      let links = (await getMealFoodItemsBatch(user, [mealId])).get(mealId) ?? []
      const recipeLink = links.find((l) => l.food_item_id === recipe.id)!
      expect(recipeLink.calories).toBe(142)

      // Now fiddle with the recipe directly via stale row columns to simulate
      // a snapshot taken before the bug fix landed (older meal data). We
      // overwrite the junction row, then verify resnapshot fixes it.
      const bananaLinkBefore = links.find((l) => l.food_item_id === banana.id)!
      expect(bananaLinkBefore.calories).toBe(89)

      // Tweak ingredients: bump oil to 25 g → 500×0.02 + 25×8.8 = 10 + 220 = 230.
      await setIngredients(user, recipe.id, [
        { ingredient_food_item_id: coffee.id, quantity: 500, sort_order: 0, unit: 'g' },
        { ingredient_food_item_id: oil.id, quantity: 25, sort_order: 1, unit: 'g' },
      ])

      const result = await resnapshotMealsForFoodItem(user, recipe.id)
      expect(result.meals_updated).toBe(1)
      expect(result.rows_updated).toBe(1)

      links = (await getMealFoodItemsBatch(user, [mealId])).get(mealId) ?? []
      const refreshed = links.find((l) => l.food_item_id === recipe.id)!
      expect(refreshed.calories).toBe(230)
      // Banana row stays untouched.
      const bananaAfter = links.find((l) => l.food_item_id === banana.id)!
      expect(bananaAfter.calories).toBe(89)

      // Meal-level macros recomputed from the new junction rows.
      const meal = await getMealById(user, mealId)
      expect(meal!.calories).toBe(319) // 230 + 89
    })

    test('atomic plain item — refreshes from row columns when they change', async () => {
      const user = getTestUser()
      const food = await upsertFoodItem(user, {
        calories: 200,
        default_quantity: 100,
        default_unit: 'g',
        name: 'Bread',
      })
      const meal = await addMeal(user, {
        food_items: [{ food_item_id: food.id, name: 'Bread', quantity: 50, unit: 'g' }],
        time: '2025-06-15T08:00:00Z',
      })
      // Bump the canonical calories to 240, then re-snapshot.
      await updateFoodItem(user, food.id, { calories: 240 })
      const result = await resnapshotMealsForFoodItem(user, food.id)
      expect(result.rows_updated).toBe(1)
      const links = (await getMealFoodItemsBatch(user, [meal.data!.id])).get(meal.data!.id) ?? []
      expect(links[0].calories).toBe(120) // 50/100 × 240
    })
  })

  describe('queryFrequentMeals', () => {
    test('returns frequent names with food items and icon from most recent occurrence', async () => {
      const user = getTestUser()
      const banana = await upsertFoodItem(user, {
        calories: 100,
        default_quantity: 1,
        default_unit: 'piece',
        icon: '🍌',
        name: 'Banana',
      })
      const coffee = await upsertFoodItem(user, {
        calories: 5,
        default_quantity: 1,
        default_unit: 'cup',
        icon: '☕',
        name: 'Coffee',
      })

      // Bananmacka logged twice, most recent has the food items
      await addMeal(user, {
        food_items: [{ food_item_id: banana.id, name: 'Banana', quantity: 1 }],
        meal_type: 'breakfast',
        name: 'Bananmacka',
        time: '2026-04-20T08:00:00Z',
      })
      await addMeal(user, {
        food_items: [
          { food_item_id: banana.id, name: 'Banana', quantity: 1 },
          { food_item_id: coffee.id, name: 'Coffee', quantity: 1 },
        ],
        meal_type: 'breakfast',
        name: 'Bananmacka',
        time: '2026-04-26T08:00:00Z',
      })

      const result = await queryFrequentMeals(user, { meal_type: 'breakfast' })

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(1)
      const entry = result.data[0]
      expect(entry.name).toBe('Bananmacka')
      expect(entry.count).toBe(2)
      // Icon picked from the first food item of the most recent occurrence
      expect(entry.icon).toBe('🍌')
      expect(entry.food_items?.map((fi) => fi.name)).toEqual(['Banana', 'Coffee'])
    })

    test('returns null icon when most recent occurrence has no food items', async () => {
      const user = getTestUser()

      await addMeal(user, {
        meal_type: 'breakfast',
        name: 'Toast',
        time: '2026-04-26T08:00:00Z',
      })

      const result = await queryFrequentMeals(user, { meal_type: 'breakfast' })
      expect(result.data).toHaveLength(1)
      expect(result.data[0].icon).toBeNull()
      expect(result.data[0].food_items).toBeUndefined()
    })
  })

  describe('food item display is resolved live', () => {
    test('editing a food item icon updates the icon on past meals (the timeline-stack bug)', async () => {
      const user = getTestUser()
      const bread = await upsertFoodItem(user, {
        calories: 200,
        default_quantity: 100,
        default_unit: 'g',
        name: 'Vitlöksbaguette',
      })

      const meal = await addMeal(user, {
        food_items: [{ food_item_id: bread.id, name: 'Vitlöksbaguette', quantity: 100, unit: 'g' }],
        meal_type: 'lunch',
        time: '2026-04-26T12:00:00Z',
      })
      const mealId = meal.data!.id

      // No icon at meal-creation time → meal renders without one.
      const before = await getMeal(user, mealId)
      expect(before.data!.food_items?.[0].icon).toBeUndefined()

      // User decorates the food item *after* logging the meal — the timeline
      // should pick this up immediately, no resnapshot needed.
      await updateFoodItem(user, bread.id, { icon: '🥖' })

      const after = await getMeal(user, mealId)
      expect(after.data!.food_items?.[0].icon).toBe('🥖')
      expect(after.data!.food_items?.[0].name).toBe('Vitlöksbaguette')
    })

    test('flagging a food item after meal creation reflects on past meals (no resnapshot)', async () => {
      const user = getTestUser()
      const bread = await upsertFoodItem(user, {
        calories: 200,
        default_quantity: 100,
        default_unit: 'g',
        name: 'Bröd',
      })
      const meal = await addMeal(user, {
        food_items: [{ food_item_id: bread.id, name: 'Bröd', quantity: 100, unit: 'g' }],
        meal_type: 'dinner',
        time: '2026-04-26T18:00:00Z',
      })
      const mealId = meal.data!.id

      // No flag at meal-creation time → meal renders without sensitivities.
      const before = await getMeal(user, mealId)
      expect(before.data!.food_items?.[0].sensitivities).toBeUndefined()
      expect(before.data!.sensitivities).toBeUndefined()

      // User flags the food item *after* logging the meal.
      const gluten = await insertSensitivityFlag(user, { name: 'Gluten' })
      await setFoodItemSensitivities(user, bread.id, [gluten.id])

      const after = await getMeal(user, mealId)
      expect(after.data!.food_items?.[0].sensitivities).toEqual(['Gluten'])
      // meal-level sensitivities surface the union of direct + item-derived flags.
      expect(after.data!.sensitivities).toEqual(['Gluten'])
    })

    test('un-flagging a food item removes the flag from past meals', async () => {
      const user = getTestUser()
      const dairy = await insertSensitivityFlag(user, { name: 'Dairy' })
      const milk = await upsertFoodItem(user, {
        calories: 50,
        default_quantity: 100,
        default_unit: 'ml',
        name: 'Milk',
      })
      await setFoodItemSensitivities(user, milk.id, [dairy.id])

      const meal = await addMeal(user, {
        food_items: [{ food_item_id: milk.id, name: 'Milk', quantity: 200, unit: 'ml' }],
        meal_type: 'breakfast',
        time: '2026-04-26T08:00:00Z',
      })
      const mealId = meal.data!.id

      const before = await getMeal(user, mealId)
      expect(before.data!.food_items?.[0].sensitivities).toEqual(['Dairy'])
      // Item-only flags also surface on the meal-level union when nothing
      // is set directly on the meal row.
      expect(before.data!.sensitivities).toEqual(['Dairy'])

      // Remove the flag — the meal should immediately reflect this.
      await setFoodItemSensitivities(user, milk.id, [])

      const after = await getMeal(user, mealId)
      expect(after.data!.food_items?.[0].sensitivities).toBeUndefined()
      expect(after.data!.sensitivities).toBeUndefined()
    })

    test('meal direct flags merge with item-derived flags into a deduped union', async () => {
      const user = getTestUser()
      const gluten = await insertSensitivityFlag(user, { name: 'Gluten' })
      const dairy = await insertSensitivityFlag(user, { name: 'Dairy' })
      const bread = await upsertFoodItem(user, {
        calories: 200,
        default_quantity: 100,
        default_unit: 'g',
        name: 'Bröd',
      })
      await setFoodItemSensitivities(user, bread.id, [gluten.id])

      const meal = await addMeal(user, {
        food_items: [{ food_item_id: bread.id, name: 'Bröd', quantity: 50, unit: 'g' }],
        meal_type: 'breakfast',
        // Direct flag set on the meal — overlaps with item-derived flag.
        sensitivities: ['Gluten', 'Dairy'],
        time: '2026-04-26T08:00:00Z',
      })

      // Sanity: stored meal row has only the directly-set flags.
      const stored = await getMealById(user, meal.data!.id)
      expect(new Set(stored!.sensitivities ?? [])).toEqual(new Set(['Gluten', 'Dairy']))
      expect(dairy.id).toBeTruthy()

      const fetched = await getMeal(user, meal.data!.id)
      // API response is the union: 'Gluten' is direct AND item-derived; 'Dairy' is direct only.
      expect(new Set(fetched.data!.sensitivities ?? [])).toEqual(new Set(['Gluten', 'Dairy']))
      expect(fetched.data!.food_items?.[0].sensitivities).toEqual(['Gluten'])
    })

    test('renaming a food item updates the name on past meals', async () => {
      const user = getTestUser()
      const item = await upsertFoodItem(user, {
        calories: 90,
        default_quantity: 1,
        default_unit: 'piece',
        icon: '🍌',
        name: 'Banana',
      })

      const meal = await addMeal(user, {
        food_items: [{ food_item_id: item.id, name: 'Banana', quantity: 1 }],
        meal_type: 'snack',
        time: '2026-04-26T15:00:00Z',
      })

      await updateFoodItem(user, item.id, { name: 'Banan' })

      const refreshed = await getMeal(user, meal.data!.id)
      expect(refreshed.data!.food_items?.[0].name).toBe('Banan')
    })
  })

  describe('portion-based meal logging', () => {
    test('scales nutrients via portion: 3 × ruta (3.4 g) on a 100 g chocolate base', async () => {
      const user = getTestUser()
      const choklad = await upsertFoodItem(user, {
        calories: 500,
        default_quantity: 100,
        default_unit: 'g',
        fat: 30,
        name: 'Choklad',
      })
      const ruta = await insertFoodItemPortion(user, {
        food_item_id: choklad.id,
        label_unit: 'ruta',
        base_equivalent: 3.4,
      })

      const result = await addMeal(user, {
        food_items: [
          {
            food_item_id: choklad.id,
            food_item_portion_id: ruta.id,
            portion_count: 3,
            name: 'Choklad',
          },
        ],
        time: '2026-04-26T15:00:00Z',
      })
      expect(result.success).toBe(true)

      const links = (await getMealFoodItemsBatch(user, [result.data!.id])).get(result.data!.id) ?? []
      expect(links).toHaveLength(1)
      // 3 × 3.4 / 100 = 0.102 scale; 500 kcal × 0.102 = 51 kcal; 30 fat × 0.102 = 3.06
      expect(links[0].calories).toBeCloseTo(51, 2)
      expect(links[0].fat).toBeCloseTo(3.06, 2)
      // Display fallback: quantity is the entered portion_count; unit is label_unit
      expect(links[0].quantity).toBe(3)
      expect(links[0].unit).toBe('ruta')
      expect(links[0].food_item_portion_id).toBe(ruta.id)
      expect(links[0].portion_count).toBe(3)
      expect(result.data!.calories).toBeCloseTo(51, 2)
    })

    test('rejects portion that does not belong to the food — returns failure, no orphan meal row', async () => {
      const user = getTestUser()
      const foodA = await upsertFoodItem(user, { name: 'A', default_quantity: 100, default_unit: 'g' })
      const foodB = await upsertFoodItem(user, { name: 'B', default_quantity: 100, default_unit: 'g' })
      const portionA = await insertFoodItemPortion(user, {
        food_item_id: foodA.id,
        label_unit: 'x',
        base_equivalent: 1,
      })

      const result = await addMeal(user, {
        food_items: [
          {
            food_item_id: foodB.id,
            food_item_portion_id: portionA.id,
            portion_count: 2,
            name: 'B',
          },
        ],
        time: '2026-04-26T15:00:00Z',
      })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/does not belong/i)
      // Regression: addMeal used to throw mid-flight, AFTER the meal row was
      // upserted — leaving an orphan meal with no items behind. The fix
      // pre-validates portions before any DB write.
      const allMeals = await dbGetMeals(user, {
        start: new Date('2026-04-26T00:00:00Z'),
        end: new Date('2026-04-27T00:00:00Z'),
      })
      expect(allMeals).toHaveLength(0)
    })

    test('rejects portion_count missing / non-positive when portion_id is set', async () => {
      const user = getTestUser()
      const food = await upsertFoodItem(user, { name: 'F', default_quantity: 100, default_unit: 'g' })
      const portion = await insertFoodItemPortion(user, {
        food_item_id: food.id,
        label_unit: 'x',
        base_equivalent: 1,
      })
      const result = await addMeal(user, {
        food_items: [{ food_item_id: food.id, food_item_portion_id: portion.id, name: 'F' }],
        time: '2026-04-26T15:00:00Z',
      })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/portion_count/i)
      expect(result.errorCode).toBe('invalid')
    })

    test('updateMealById distinguishes not_found from invalid via errorCode', async () => {
      const user = getTestUser()
      // not_found: nothing exists at this id.
      const notFound = await updateMealById(user, '00000000-0000-0000-0000-000000000001', {
        food_items: [],
      })
      expect(notFound.success).toBe(false)
      expect(notFound.errorCode).toBe('not_found')

      // invalid: meal exists but portion targets a different food.
      const foodA = await upsertFoodItem(user, { name: 'A', default_quantity: 100, default_unit: 'g' })
      const foodB = await upsertFoodItem(user, { name: 'B', default_quantity: 100, default_unit: 'g' })
      const portionA = await insertFoodItemPortion(user, {
        food_item_id: foodA.id,
        label_unit: 'x',
        base_equivalent: 1,
      })
      const meal = await addMeal(user, {
        food_items: [{ food_item_id: foodB.id, name: 'B', quantity: 100, unit: 'g' }],
        time: '2026-04-26T15:00:00Z',
      })
      const bad = await updateMealById(user, meal.data!.id, {
        food_items: [
          { food_item_id: foodB.id, food_item_portion_id: portionA.id, portion_count: 1, name: 'B' },
        ],
      })
      expect(bad.success).toBe(false)
      expect(bad.errorCode).toBe('invalid')
      expect(bad.error).toMatch(/does not belong/i)
    })

    test('resnapshot preserves the snapshot when the portion has been deleted', async () => {
      // Regression: if the portion was deleted since logging, the recorded
      // (quantity, unit) on the link are portion-label values (e.g. 3 ruta)
      // that don't match the canonical default_unit (g). Old behavior fell
      // back to legacy scaling which returned scale=1 → row got overwritten
      // with full per-100g values. Fix: skip recompute, preserve the frozen
      // snapshot.
      const user = getTestUser()
      const food = await upsertFoodItem(user, {
        calories: 500,
        default_quantity: 100,
        default_unit: 'g',
        name: 'Choklad',
      })
      const ruta = await insertFoodItemPortion(user, {
        food_item_id: food.id,
        label_unit: 'ruta',
        base_equivalent: 3.4,
      })
      const meal = await addMeal(user, {
        food_items: [
          { food_item_id: food.id, food_item_portion_id: ruta.id, portion_count: 3, name: 'Choklad' },
        ],
        time: '2026-04-26T15:00:00Z',
      })
      const originalCalories = meal.data!.food_items![0].calories!
      expect(originalCalories).toBeCloseTo(51, 2) // 500 × 3 × 3.4 / 100

      // Delete the portion that the link points at.
      await import('../db/food-item-portions.ts').then((m) => m.deleteFoodItemPortion(user, ruta.id))

      // Resnapshot must NOT clobber the row with full canonical values.
      await resnapshotMealsForFoodItem(user, food.id)
      const refreshed = await getMeal(user, meal.data!.id)
      const after = refreshed.data!.food_items![0]
      expect(after.calories).toBeCloseTo(originalCalories, 2)
      // The legacy display fallback still works — the snapshot kept label + count.
      expect(after.quantity).toBe(3)
      expect(after.unit).toBe('ruta')
    })

    test('resnapshot preserves portion link and rescales with current effective nutrients', async () => {
      const user = getTestUser()
      const food = await upsertFoodItem(user, {
        calories: 100,
        default_quantity: 100,
        default_unit: 'g',
        name: 'Choklad',
      })
      const ruta = await insertFoodItemPortion(user, {
        food_item_id: food.id,
        label_unit: 'ruta',
        base_equivalent: 5,
      })
      const meal = await addMeal(user, {
        food_items: [
          { food_item_id: food.id, food_item_portion_id: ruta.id, portion_count: 4, name: 'Choklad' },
        ],
        time: '2026-04-26T15:00:00Z',
      })
      // Bump per-100g calories from 100 → 200; resnapshot should rescale to
      // 200 × 4 × 5 / 100 = 40.
      await updateFoodItem(user, food.id, { calories: 200 })
      const out = await resnapshotMealsForFoodItem(user, food.id)
      expect(out.rows_updated).toBe(1)
      const refreshed = await getMeal(user, meal.data!.id)
      expect(refreshed.data!.food_items?.[0].calories).toBe(40)
      expect(refreshed.data!.food_items?.[0].food_item_portion_id).toBe(ruta.id)
      expect(refreshed.data!.food_items?.[0].portion_count).toBe(4)
    })
  })
})
