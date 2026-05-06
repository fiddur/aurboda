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

import { getFoodItemQualityTier, NUTRIENT_FIELD_NAMES } from '@aurboda/api-spec'

import type { FoodItemEntity } from '../db/types.ts'
import type { CentralDb } from './central-db.ts'
import type { SharedFoodItemEntity } from './central-food-items.ts'

import { query } from '../db/connection.ts'
import {
  findCompositeParentsOfIngredient,
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
  updateFoodItem as dbUpdateFoodItem,
} from '../db/food-items.ts'
import { getFoodItemSensitivities } from '../db/sensitivities.ts'

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

export interface ReferencedFood {
  /** The reference food item resolved across user + central. */
  food: MergedFoodItem
  /** True when self.default_quantity / reference.default_quantity isn't possible (missing default_quantity, or units that can't convert). Inherited values are still emitted at scale=1 but flagged so the UI can warn. */
  unit_mismatch: boolean
}

/**
 * Per-field origin info for an atomic item with an optional reference.
 * Each entry says where the value came from — the item itself, an inherited
 * reference, or both (with the self winning).
 */
export interface FieldOrigin {
  origin: 'self' | 'reference'
  value: number | string
}

export interface ReferenceEnrichedFields {
  /** Map of NUTRIENT_FIELD_NAME → { origin, value }. Only entries that have a value (self or inherited) appear. */
  fields: Record<string, FieldOrigin>
}

export interface FoodItemDetail {
  item: MergedFoodItem
  /** Present iff the item is a per-user composite. */
  ingredients?: ResolvedIngredient[]
  /** Derived nutrient totals when composite; absent for atomic items. */
  derived_nutrients?: DerivedNutrients
  /** Set when the atomic item has a reference_food_item_id set. Provides the resolved reference + per-field origin info. */
  reference?: ReferencedFood
  /** Per-field origin map — set together with `reference`. */
  reference_enriched?: ReferenceEnrichedFields
  /** Sensitivity flags assigned to this food item via the food_item_sensitivities junction. Always populated (empty when no flags). */
  sensitivities?: Array<{ id: string; name: string; color?: string | null }>
}

/**
 * Resolve the effective per-default-quantity nutrient values for a food item:
 * - composite → live derived totals from ingredients (the row columns may be
 *   stale leftover values from before the conversion to composite)
 * - reference-enriched atomic → self values + reference values for empty fields
 * - plain atomic → the row's own nutrient columns
 *
 * Used at meal-snapshot time so meals reflect the current recipe / reference.
 */
export const getEffectiveNutrients = (detail: FoodItemDetail): Record<string, number> => {
  const result: Record<string, number> = {}
  if (detail.derived_nutrients) {
    for (const [k, v] of Object.entries(detail.derived_nutrients.values)) {
      if (typeof v === 'number') result[k] = v
    }
    return result
  }
  if (detail.reference_enriched) {
    for (const [k, info] of Object.entries(detail.reference_enriched.fields)) {
      if (typeof info.value === 'number') result[k] = info.value
    }
    return result
  }
  for (const field of NUTRIENT_FIELD_NAMES) {
    const v = detail.item[field]
    if (typeof v === 'number') result[field] = v
  }
  return result
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
 * Compute the scale factor between a self food item and its reference.
 * Reference values are stored "per default_quantity"; if the self item also
 * specifies default_quantity (and units match or convert), we scale by
 * `self.default_quantity / ref.default_quantity`. When units don't match
 * and don't convert, return scale=1 + unit_mismatch=true so the caller can
 * surface a warning instead of silently producing wrong-magnitude values.
 */
const computeReferenceScale = (
  self: MergedFoodItem,
  ref: MergedFoodItem,
): { scale: number; unit_mismatch: boolean } => {
  const selfQty = self.default_quantity as number | undefined
  const refQty = ref.default_quantity as number | undefined
  if (selfQty === undefined || refQty === undefined || refQty === 0) {
    return { scale: 1, unit_mismatch: true }
  }
  const selfUnit = self.default_unit as string | undefined
  const refUnit = ref.default_unit as string | undefined
  if (selfUnit && refUnit && selfUnit !== refUnit) {
    const converted = convertUnit(selfQty, selfUnit, refUnit)
    if (converted === undefined) return { scale: 1, unit_mismatch: true }
    return { scale: converted / refQty, unit_mismatch: false }
  }
  return { scale: selfQty / refQty, unit_mismatch: false }
}

/**
 * Build a `FoodItemDetail` with reference-origin nutrients merged in.
 * Self values always win; reference values fill empty fields, scaled by
 * `self.default_quantity / ref.default_quantity` when units match.
 *
 * When units can't be reliably converted (`unit_mismatch=true`), self values
 * are still emitted but reference values are dropped — surfacing a
 * wrong-magnitude number with a warning is more confusing than no value.
 * The UI shows a banner pointing the user at the unit settings instead.
 */
const enrichWithReference = (self: MergedFoodItem, ref: MergedFoodItem): FoodItemDetail => {
  const { scale, unit_mismatch } = computeReferenceScale(self, ref)
  const fields: Record<string, FieldOrigin> = {}
  for (const field of NUTRIENT_FIELD_NAMES) {
    const selfVal = self[field]
    if (typeof selfVal === 'number') {
      fields[field] = { origin: 'self', value: selfVal }
      continue
    }
    if (unit_mismatch) continue
    const refVal = ref[field]
    if (typeof refVal === 'number') {
      fields[field] = { origin: 'reference', value: round2(refVal * scale) }
    }
  }
  return {
    item: self,
    reference: { food: ref, unit_mismatch },
    reference_enriched: { fields },
  }
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
    // Merge by quality tier so high-quality central LSV entries surface
    // above kcal-only oura imports. User items come first in the spread,
    // and Array.prototype.sort is stable since ES2019 — so within a tier,
    // user-origin items keep their lead over central ones.
    const tiered = [...userItems, ...sharedItems].map((item) => ({
      item,
      tier: getFoodItemQualityTier(item),
    }))
    tiered.sort((a, b) => a.tier - b.tier)
    return tiered.slice(0, limit).map((t) => t.item)
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
    // Sensitivity flags work for both per-user and central items — the
    // junction's food_item_id is a soft pointer, so a user can flag a
    // central LSV item just as easily as one of their own.
    const sensitivityFlags = await getFoodItemSensitivities(user, id)
    const sensitivities = sensitivityFlags.map((f) => ({ id: f.id, name: f.name, color: f.color ?? null }))

    const fromUser = await getUserFoodItemById(user, id)
    if (fromUser) {
      // Composite path takes precedence over reference enrichment — a
      // recipe's nutrients are entirely derived from its ingredients, so
      // a reference would be ignored anyway.
      if (fromUser.is_composite) {
        const rows = await dbGetIngredients(user, id)
        if (rows.length === 0) return { item: fromUser, sensitivities }
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
          sensitivities,
        }
      }

      // Atomic per-user item — resolve the reference (if any) and emit
      // per-field origin info. Defence in depth: skip enrichment when the
      // resolved target is itself a composite. Composite columns are sparse
      // (real values live in derived_nutrients), so reading them as
      // inheritable nutrients would surface stale/empty numbers. The route +
      // MCP layers also reject composite targets up-front.
      const refId = fromUser.reference_food_item_id as string | undefined
      if (refId) {
        const refFood =
          (await getUserFoodItemById(user, refId)) ?? (await centralDb.getSharedFoodItemById(refId))
        if (refFood && !refFood.is_composite) {
          return { ...enrichWithReference(fromUser, refFood), sensitivities }
        }
      }
      return { item: fromUser, sensitivities }
    }
    const fromCentral = await centralDb.getSharedFoodItemById(id)
    return fromCentral ? { item: fromCentral, sensitivities } : null
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
// Composite nutrient cache
// ============================================================================

/**
 * Recompute a composite item's derived nutrient totals and write them onto
 * its `food_items` row columns, then walk up to every parent recipe that
 * uses this item and re-cache them too.
 *
 * Why cache: read paths (search dropdown, frequent-meal queries, parent
 * recipes summing ingredient values) all read `food_items.<nutrient>`
 * directly from the row. Without the cache, composite rows have stale or
 * null values from before the conversion to composite, so search shows
 * dashes and parents-of-composites silently miss their child's contribution.
 *
 * Why propagate: editing recipe A invalidates the cache on every recipe B
 * that contains A. Without propagation a parent stays at the previous totals
 * until manually re-saved. The recursion terminates because the cycle check
 * in `wouldCreateCycle` rejects ingredient cycles, but `visited` is a
 * defence-in-depth guard.
 *
 * Atomic items aren't touched — their nutrients are user-authoritative.
 */
export const cacheCompositeNutrients = async (
  user: string,
  centralDb: CentralDb,
  foodItemId: string,
  visited: Set<string> = new Set(),
): Promise<void> => {
  if (visited.has(foodItemId)) return
  visited.add(foodItemId)

  const item = await getUserFoodItemById(user, foodItemId)
  if (!item?.is_composite) return

  const service = createFoodItemsService(centralDb)
  const detail = await service.getDetail(user, foodItemId)
  const values = detail?.derived_nutrients?.values ?? {}

  const update: Record<string, number | null> = {}
  for (const field of NUTRIENT_FIELD_NAMES) {
    const v = values[field]
    update[field] = typeof v === 'number' ? v : null
  }
  await dbUpdateFoodItem(user, foodItemId, update)

  const parents = await findCompositeParentsOfIngredient(user, foodItemId)
  for (const parentId of parents) {
    await cacheCompositeNutrients(user, centralDb, parentId, visited)
  }
}

/**
 * Mirror of `cacheCompositeNutrients` for the clear-ingredients path: null
 * out the cached nutrient columns (the item is no longer composite, so its
 * row should not carry stale derived totals), then refresh parents.
 */
export const clearCompositeNutrientCache = async (
  user: string,
  centralDb: CentralDb,
  foodItemId: string,
): Promise<void> => {
  const update: Record<string, null> = {}
  for (const field of NUTRIENT_FIELD_NAMES) update[field] = null
  await dbUpdateFoodItem(user, foodItemId, update)

  // Don't recurse through this id: the parents need refreshing, but we
  // already updated this row, and the item itself is no longer composite.
  const parents = await findCompositeParentsOfIngredient(user, foodItemId)
  const visited = new Set([foodItemId])
  for (const parentId of parents) {
    await cacheCompositeNutrients(user, centralDb, parentId, visited)
  }
}

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
