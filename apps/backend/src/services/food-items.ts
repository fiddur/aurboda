/**
 * Food-items service: composes per-user food_items with central
 * shared_food_items so callers see one merged library.
 *
 * Read paths (search/get/getByName/findOrCreate) check central whenever the
 * per-user DB doesn't have the item. Write paths (upsert/update/delete)
 * stay confined to the per-user DB; central rows are managed exclusively
 * by the admin import flow (see services/imports/runner.ts).
 *
 * UUIDs are globally unique, so user-DB rows and central-DB rows never
 * collide; we don't need a namespace prefix on IDs.
 */

import { NUTRIENT_FIELD_NAMES } from '@aurboda/api-spec'

import type { FoodItemEntity } from '../db/types.ts'
import type { CentralDb } from './central-db.ts'
import type { SharedFoodItemEntity } from './central-food-items.ts'

import {
  type FoodItemIngredientRow,
  getIngredients as dbGetIngredients,
} from '../db/food-item-ingredients.ts'
import {
  findOrCreateFoodItem as findOrCreateUserFoodItem,
  getFoodItemById as getUserFoodItemById,
  getFoodItemByName as getUserFoodItemByName,
  type InsertFoodItemInput,
  searchFoodItems as searchUserFoodItems,
} from '../db/food-items.ts'

/**
 * `MergedFoodItem` is intentionally the union of user and central entity
 * types. Both have the same nutrient shape; the service just promises that
 * the row came from one of the two stores.
 */
export type MergedFoodItem = FoodItemEntity | SharedFoodItemEntity

export interface ResolvedIngredient {
  /** The junction row (parent → ingredient pointer + qty/unit). */
  row: FoodItemIngredientRow
  /** The actual ingredient food item, resolved across user + central. */
  food: MergedFoodItem | null
}

export interface DerivedNutrients {
  /** Sum of (ingredient.value × scale) across all resolvable ingredients. */
  values: Record<string, number>
  /**
   * True if any ingredient lacks a calorie value or could not be resolved —
   * meal totals computed from this composite would be understated.
   */
  nutrient_data_incomplete: boolean
}

export interface FoodItemDetail {
  item: MergedFoodItem
  /** Present iff the item is a per-user composite. */
  ingredients?: ResolvedIngredient[]
  /** Derived nutrient totals when composite; absent for atomic items. */
  derived_nutrients?: DerivedNutrients
}

export interface FoodItemsService {
  search: (user: string, q: string, limit?: number) => Promise<MergedFoodItem[]>
  getById: (user: string, id: string) => Promise<MergedFoodItem | null>
  getByName: (user: string, name: string) => Promise<MergedFoodItem | null>
  findOrCreate: (
    user: string,
    name: string,
    defaults?: Partial<InsertFoodItemInput>,
  ) => Promise<MergedFoodItem>
  /** Get the item plus, if composite, its ingredients + derived nutrients. */
  getDetail: (user: string, id: string) => Promise<FoodItemDetail | null>
  /**
   * Cycle guard for setIngredients. Walks the ingredient graph from each
   * candidate looking for `parentId`. Per-user FK already prevents pointing
   * at non-existent parents; this defends against `A → B → A`-style loops
   * across the user's own composites.
   */
  wouldCreateCycle: (user: string, parentId: string, ingredientIds: string[]) => Promise<boolean>
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Convert a quantity from one unit to another for a small set of standard
 * mass and volume scales. Returns undefined when the units are different
 * dimensions (e.g. "g" → "ml") or unknown — callers should treat that as
 * "can't scale, flag as incomplete".
 */
const convertUnit = (qty: number, from: string, to: string): number | undefined => {
  if (from === to) return qty
  const mass: Record<string, number> = { g: 1, kg: 1000, mg: 0.001, µg: 0.000_001 }
  const volume: Record<string, number> = { ml: 1, dl: 100, cl: 10, l: 1000 }
  const f = from.toLowerCase().trim()
  const t = to.toLowerCase().trim()
  if (f in mass && t in mass) return (qty * mass[f]) / mass[t]
  if (f in volume && t in volume) return (qty * volume[f]) / volume[t]
  return undefined
}

interface ScaleResult {
  scale: number
  /** True if scaling could not be done reliably — caller flips incomplete flag. */
  incomplete: boolean
}

/**
 * Compute the scale factor between an ingredient's quantity and its
 * canonical default_quantity. Same units → straight ratio. Different but
 * dimensionally-compatible units (e.g. dl ↔ ml) → convert. Anything else
 * (mismatched dimension, missing default_quantity) → scale = 1 + incomplete
 * flag so the user knows totals can't be trusted.
 */
const computeIngredientScale = (
  ingredientQuantity: number,
  ingredientUnit: string | undefined,
  food: MergedFoodItem,
): ScaleResult => {
  const defaultQty = food.default_quantity as number | undefined
  if (defaultQty === undefined || defaultQty === null || defaultQty === 0) {
    return { incomplete: true, scale: 1 }
  }
  const defaultUnit = food.default_unit as string | undefined
  if (ingredientUnit && defaultUnit && ingredientUnit !== defaultUnit) {
    const converted = convertUnit(ingredientQuantity, ingredientUnit, defaultUnit)
    if (converted === undefined) return { incomplete: true, scale: 1 }
    return { incomplete: false, scale: converted / defaultQty }
  }
  return { incomplete: false, scale: ingredientQuantity / defaultQty }
}

/**
 * Sum each nutrient column across the resolved ingredients × per-ingredient
 * scale. Ingredients we couldn't resolve, ingredients without a calorie
 * reading, and ingredients we couldn't scale reliably (missing default_qty
 * or incompatible units) all flip `nutrient_data_incomplete` so callers
 * know the totals are partial. Rounding is applied once at the end so
 * accumulated error doesn't compound.
 */
export const aggregateNutrientsFromIngredients = (ingredients: ResolvedIngredient[]): DerivedNutrients => {
  const values: Record<string, number> = {}
  let incomplete = false
  for (const { row, food } of ingredients) {
    if (!food) {
      incomplete = true
      continue
    }
    if (typeof food.calories !== 'number') incomplete = true
    const { scale, incomplete: scaleIncomplete } = computeIngredientScale(row.quantity, row.unit, food)
    if (scaleIncomplete) incomplete = true
    for (const field of NUTRIENT_FIELD_NAMES) {
      const v = food[field]
      if (typeof v === 'number') {
        values[field] = (values[field] ?? 0) + v * scale
      }
    }
  }
  for (const field of Object.keys(values)) values[field] = round2(values[field])
  return { nutrient_data_incomplete: incomplete, values }
}

export const createFoodItemsService = (centralDb: CentralDb): FoodItemsService => ({
  search: async (user, q, limit = 20) => {
    const [userItems, sharedItems] = await Promise.all([
      searchUserFoodItems(user, q, limit),
      centralDb.searchSharedFoodItems(q, limit),
    ])
    // User items rank first — their own custom names + the LSV reference set
    // is the natural ordering. Limit applies to the combined list.
    return [...userItems, ...sharedItems].slice(0, limit)
  },

  getById: async (user, id) => {
    const fromUser = await getUserFoodItemById(user, id)
    if (fromUser) return fromUser
    return centralDb.getSharedFoodItemById(id)
  },

  getByName: async (user, name) => {
    const fromUser = await getUserFoodItemByName(user, name)
    if (fromUser) return fromUser
    return centralDb.getSharedFoodItemByName(name)
  },

  findOrCreate: async (user, name, defaults) => {
    // Prefer the central canonical entry over creating a per-user duplicate.
    // Exact name match only — fuzzy resolution would silently bind a meal to
    // the wrong food item.
    const central = await centralDb.getSharedFoodItemByName(name)
    if (central) return central
    const fromUser = await getUserFoodItemByName(user, name)
    if (fromUser) return fromUser
    return findOrCreateUserFoodItem(user, name, defaults)
  },

  getDetail: async (user, id) => {
    const fromUser = await getUserFoodItemById(user, id)
    if (fromUser) {
      // Skip the junction lookup for atomic items — most reads.
      if (!fromUser.is_composite) return { item: fromUser }
      const rows = await dbGetIngredients(user, id)
      if (rows.length === 0) return { item: fromUser }
      const resolved: ResolvedIngredient[] = await Promise.all(
        rows.map(async (row) => {
          const food =
            (await getUserFoodItemById(user, row.ingredient_food_item_id)) ??
            (await centralDb.getSharedFoodItemById(row.ingredient_food_item_id))
          return { food, row }
        }),
      )
      return {
        derived_nutrients: aggregateNutrientsFromIngredients(resolved),
        ingredients: resolved,
        item: fromUser,
      }
    }
    const fromCentral = await centralDb.getSharedFoodItemById(id)
    return fromCentral ? { item: fromCentral } : null
  },

  wouldCreateCycle: async (user, parentId, ingredientIds) => {
    // Direct self-reference is already enforced by the SQL CHECK; the
    // transitive case isn't.
    if (ingredientIds.includes(parentId)) return true
    // BFS from each candidate ingredient through the user's composite graph.
    // Central items have no ingredients, so we only need user data.
    const visited = new Set<string>()
    const queue = [...ingredientIds]
    while (queue.length > 0) {
      const next = queue.shift()!
      if (visited.has(next)) continue
      visited.add(next)
      const rows = await dbGetIngredients(user, next)
      for (const row of rows) {
        if (row.ingredient_food_item_id === parentId) return true
        if (!visited.has(row.ingredient_food_item_id)) {
          queue.push(row.ingredient_food_item_id)
        }
      }
    }
    return false
  },
})
