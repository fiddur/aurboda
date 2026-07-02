/**
 * food_item_ingredients junction table — backs composite (recipe-style)
 * food items.
 *
 * `parent_food_item_id` is FK'd to per-user food_items (CASCADE on delete).
 * `ingredient_food_item_id` is a soft pointer that may resolve to a per-user
 * row or a central shared_food_items row, so there's no FK on it. Cycle
 * prevention is enforced in the service layer (see wouldCreateCycle).
 *
 * Quantities are scaled against the ingredient's own default_quantity at
 * read time to derive the parent's nutrient totals.
 */

import { query } from './connection.ts'

const COLUMNS =
  'id, parent_food_item_id, ingredient_food_item_id, quantity, unit, food_item_portion_id, portion_count, sort_order, created_at, updated_at'

export interface FoodItemIngredientRow {
  id: string
  parent_food_item_id: string
  ingredient_food_item_id: string
  quantity: number
  unit?: string
  /** When set, the ingredient is measured in this portion (unit); scaling uses portion_count × base_equivalent. */
  food_item_portion_id?: string
  /** The count entered in the portion's unit (paired with food_item_portion_id). */
  portion_count?: number
  sort_order: number
  created_at: Date
  updated_at: Date
}

export interface FoodItemIngredientInput {
  ingredient_food_item_id: string
  quantity: number
  unit?: string
  food_item_portion_id?: string
  portion_count?: number
  sort_order?: number
}

const mapRow = (row: Record<string, unknown>): FoodItemIngredientRow => ({
  created_at: new Date(row.created_at as string),
  id: row.id as string,
  ingredient_food_item_id: row.ingredient_food_item_id as string,
  parent_food_item_id: row.parent_food_item_id as string,
  quantity: Number(row.quantity),
  food_item_portion_id: (row.food_item_portion_id as string | null) ?? undefined,
  portion_count: row.portion_count == null ? undefined : Number(row.portion_count),
  sort_order: Number(row.sort_order),
  unit: (row.unit as string | null) ?? undefined,
  updated_at: new Date(row.updated_at as string),
})

/**
 * Get all ingredients of one composite food, ordered by sort_order.
 */
export const getIngredients = async (
  user: string,
  parentFoodItemId: string,
): Promise<FoodItemIngredientRow[]> => {
  const result = await query(
    user,
    `SELECT ${COLUMNS}
     FROM food_item_ingredients
     WHERE parent_food_item_id = $1
     ORDER BY sort_order, created_at`,
    [parentFoodItemId],
  )
  return result.rows.map(mapRow)
}

/**
 * Replace all ingredients for a composite parent (delete + bulk insert)
 * inside a single transaction. Marks the parent food_items row as composite.
 *
 * Atomicity matters: a partial failure (FK violation, SQL CHECK firing on
 * a self-ref mid-batch, transient connection error) would otherwise leave
 * the parent with half the new ingredient list and is_composite in an
 * indeterminate state.
 *
 * The caller is responsible for cycle-checking before invoking this — see
 * wouldCreateCycle in services/food-items.ts. We rely on a service-layer
 * check rather than a SQL trigger because ingredient pointers can cross
 * databases (per-user → central) and SQL recursion can't see central rows.
 * Note that the cycle check is best-effort: two concurrent setIngredients
 * calls on related composites could each pass the check independently and
 * still produce a cycle. Per-user dbs make this rare.
 */
export const setIngredients = async (
  user: string,
  parentFoodItemId: string,
  items: FoodItemIngredientInput[],
): Promise<void> => {
  try {
    await query(user, 'BEGIN')
    await query(user, `DELETE FROM food_item_ingredients WHERE parent_food_item_id = $1`, [parentFoodItemId])

    if (items.length > 0) {
      // Single multi-row INSERT — 7 columns per row, parameterised.
      const params: unknown[] = []
      const valuesSql = items
        .map((item, i) => {
          const base = i * 7
          params.push(
            parentFoodItemId,
            item.ingredient_food_item_id,
            item.quantity,
            item.unit ?? null,
            item.food_item_portion_id ?? null,
            item.portion_count ?? null,
            item.sort_order ?? i,
          )
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`
        })
        .join(', ')
      await query(
        user,
        `INSERT INTO food_item_ingredients
           (parent_food_item_id, ingredient_food_item_id, quantity, unit, food_item_portion_id, portion_count, sort_order)
         VALUES ${valuesSql}`,
        params,
      )
    }

    await query(user, `UPDATE food_items SET is_composite = $2, updated_at = NOW() WHERE id = $1`, [
      parentFoodItemId,
      items.length > 0,
    ])
    await query(user, 'COMMIT')
  } catch (err) {
    await query(user, 'ROLLBACK').catch(() => {})
    throw err
  }
}

/**
 * Wipe all ingredients and clear the composite flag.
 */
export const clearIngredients = async (user: string, parentFoodItemId: string): Promise<void> => {
  await query(user, `DELETE FROM food_item_ingredients WHERE parent_food_item_id = $1`, [parentFoodItemId])
  await query(user, `UPDATE food_items SET is_composite = FALSE, updated_at = NOW() WHERE id = $1`, [
    parentFoodItemId,
  ])
}

/**
 * Find every composite parent that uses the given food item as one of its
 * ingredients. Used by the cache-propagation flow: when an item's effective
 * nutrient values change, every parent recipe needs its row cache refreshed.
 */
export const findCompositeParentsOfIngredient = async (
  user: string,
  ingredientFoodItemId: string,
): Promise<string[]> => {
  const result = await query(
    user,
    'SELECT DISTINCT parent_food_item_id FROM food_item_ingredients WHERE ingredient_food_item_id = $1',
    [ingredientFoodItemId],
  )
  return result.rows.map((row) => row.parent_food_item_id as string)
}

/**
 * Batch fetch ingredients for several parents at once. Returns a map keyed
 * by parent_food_item_id; absent keys = no ingredients.
 */
export const getIngredientsBatch = async (
  user: string,
  parentIds: string[],
): Promise<Map<string, FoodItemIngredientRow[]>> => {
  if (parentIds.length === 0) return new Map()
  const placeholders = parentIds.map((_, i) => `$${i + 1}`).join(', ')
  const result = await query(
    user,
    `SELECT ${COLUMNS}
     FROM food_item_ingredients
     WHERE parent_food_item_id IN (${placeholders})
     ORDER BY parent_food_item_id, sort_order, created_at`,
    parentIds,
  )
  const map = new Map<string, FoodItemIngredientRow[]>()
  for (const row of result.rows) {
    const link = mapRow(row)
    const existing = map.get(link.parent_food_item_id) ?? []
    existing.push(link)
    map.set(link.parent_food_item_id, existing)
  }
  return map
}
