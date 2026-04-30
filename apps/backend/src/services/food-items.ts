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

import { query } from '../db/connection.ts'
import {
  type FoodItemIngredientRow,
  getIngredients as dbGetIngredients,
} from '../db/food-item-ingredients.ts'
import {
  findOrCreateFoodItem as findOrCreateUserFoodItem,
  getFoodItemById as getUserFoodItemById,
  getFoodItemByName as getUserFoodItemByName,
  type InsertFoodItemInput,
  type MergeFoodItemResult,
  mergeFoodItems as dbMergeFoodItems,
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

// ============================================================================
// Merge two food items
// ============================================================================

/**
 * One nutrient/icon/default_* field that the source has populated and the
 * target does not — surfaced in the merge preview so the UI can offer the
 * user the choice "fill the empty fields from source / drop them / cancel".
 */
export interface MergeFillCandidate {
  field: string
  source_value: number | string
}

export interface MergeFoodItemsPreview {
  source_id: string
  target_id: string
  source_name: string
  target_name: string
  /** True if the target lives in the central shared library (read-only). */
  target_is_central: boolean
  /** Number of meal_food_items snapshots that will be re-pointed. */
  meals_repointed: number
  /** Number of food_item_ingredients pointers that will be re-pointed. */
  ingredients_repointed: number
  /** True if the source itself is a composite parent — its ingredients will be discarded on merge. */
  source_is_composite: boolean
  /** Empty target fields the source could fill, IF the target is per-user. */
  fill_candidates: MergeFillCandidate[]
}

const FILLABLE_FIELDS_FOR_PREVIEW = [
  ...NUTRIENT_FIELD_NAMES,
  'icon',
  'default_quantity',
  'default_unit',
] as const

export interface FoodItemsMergeService {
  preview: (user: string, sourceId: string, targetId: string) => Promise<MergeFoodItemsPreview>
  /**
   * Execute the merge.
   * @param fillEmpty when true, fill the target's empty fields from the source.
   *   Ignored (logged) when the target is central — central items aren't
   *   editable from a per-user merge.
   * @param confirmDiscardIngredients required when the source is itself a
   *   composite parent — protects against accidentally losing a recipe.
   */
  merge: (
    user: string,
    sourceId: string,
    targetId: string,
    options: { fillEmpty: boolean; confirmDiscardIngredients?: boolean },
  ) => Promise<MergeFoodItemResult & { target_is_central: boolean }>
}

const isFieldEmpty = (v: unknown): boolean => v === undefined || v === null

export const createFoodItemsMergeService = (centralDb: CentralDb): FoodItemsMergeService => ({
  preview: async (user, sourceId, targetId) => {
    if (sourceId === targetId) throw new Error('Cannot merge a food item into itself')

    const source = await getUserFoodItemById(user, sourceId)
    if (!source) {
      // Central source isn't allowed (caller can't manage central data
      // from a per-user merge). Either way it's "not a valid source".
      const fromCentral = await centralDb.getSharedFoodItemById(sourceId)
      throw new Error(
        fromCentral ? 'Cannot merge from a central library item' : `Source food item not found: ${sourceId}`,
      )
    }

    let target: MergedFoodItem | null = await getUserFoodItemById(user, targetId)
    let targetIsCentral = false
    if (!target) {
      target = await centralDb.getSharedFoodItemById(targetId)
      targetIsCentral = !!target
    }
    if (!target) throw new Error(`Target food item not found: ${targetId}`)

    // Counts.
    const mealsRes = await query(
      user,
      `SELECT COUNT(*)::int AS c FROM meal_food_items WHERE food_item_id = $1`,
      [sourceId],
    )
    const ingredientsRes = await query(
      user,
      `SELECT COUNT(*)::int AS c FROM food_item_ingredients WHERE ingredient_food_item_id = $1`,
      [sourceId],
    )
    const compositeRes = await query(
      user,
      `SELECT 1 FROM food_item_ingredients WHERE parent_food_item_id = $1 LIMIT 1`,
      [sourceId],
    )

    // Fill candidates: fields source has and target doesn't. Only surface
    // when target is per-user — for central targets the dialog should hide
    // the fill-empty option entirely.
    const fillCandidates: MergeFillCandidate[] = []
    if (!targetIsCentral) {
      for (const field of FILLABLE_FIELDS_FOR_PREVIEW) {
        const sourceVal = source[field]
        const targetVal = target[field]
        if (!isFieldEmpty(sourceVal) && isFieldEmpty(targetVal)) {
          fillCandidates.push({ field, source_value: sourceVal as number | string })
        }
      }
    }

    return {
      fill_candidates: fillCandidates,
      ingredients_repointed: ingredientsRes.rows[0].c as number,
      meals_repointed: mealsRes.rows[0].c as number,
      source_id: sourceId,
      source_is_composite: compositeRes.rows.length > 0,
      source_name: source.name,
      target_id: targetId,
      target_is_central: targetIsCentral,
      target_name: target.name,
    }
  },

  merge: async (user, sourceId, targetId, options) => {
    if (sourceId === targetId) throw new Error('Cannot merge a food item into itself')

    const source = await getUserFoodItemById(user, sourceId)
    if (!source) {
      const fromCentral = await centralDb.getSharedFoodItemById(sourceId)
      throw new Error(
        fromCentral ? 'Cannot merge from a central library item' : `Source food item not found: ${sourceId}`,
      )
    }

    const targetUser = await getUserFoodItemById(user, targetId)
    let targetIsCentral = false
    if (!targetUser) {
      const targetCentral = await centralDb.getSharedFoodItemById(targetId)
      if (!targetCentral) throw new Error(`Target food item not found: ${targetId}`)
      targetIsCentral = true
    }

    // Composite source = recipe being merged away. Its parent rows in
    // food_item_ingredients cascade away with the source delete; require
    // the caller to acknowledge this so a misclick doesn't silently throw
    // away a recipe.
    const compositeRes = await query(
      user,
      `SELECT 1 FROM food_item_ingredients WHERE parent_food_item_id = $1 LIMIT 1`,
      [sourceId],
    )
    if (compositeRes.rows.length > 0 && !options.confirmDiscardIngredients) {
      throw new Error(
        'Source is a composite (recipe). Set confirmDiscardIngredients=true to merge anyway — its ingredient list will be discarded.',
      )
    }

    const result = await dbMergeFoodItems(user, sourceId, targetId, {
      // Filling only makes sense on a per-user target.
      fillEmptyFromSource: options.fillEmpty,
      targetIsUserItem: !targetIsCentral,
    })
    return { ...result, target_is_central: targetIsCentral }
  },
})
