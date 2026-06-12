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

import { type FoodItemIngredient, getFoodItemQualityTier, NUTRIENT_FIELD_NAMES } from '@aurboda/api-spec'

import type { FoodItemEntity } from '../db/types.ts'
import type { CentralDb } from './central-db.ts'
import type { SharedFoodItemEntity } from './central-food-items.ts'

import { query } from '../db/connection.ts'
import {
  findCompositeParentsOfIngredient,
  type FoodItemIngredientInput,
  type FoodItemIngredientRow,
  getIngredients as dbGetIngredients,
  setIngredients as dbSetIngredients,
} from '../db/food-item-ingredients.ts'
import {
  type FoodItemPortionRow,
  getFoodItemPortionById,
  insertFoodItemPortion,
  listPortionsForFoodItem,
} from '../db/food-item-portions.ts'
import {
  findOrCreateFoodItem as findOrCreateUserFoodItem,
  getFoodItemById as getUserFoodItemById,
  getFoodItemByName as getUserFoodItemByName,
  getFoodItemsByIds as getUserFoodItemsByIds,
  type InsertFoodItemInput,
  type MergeFoodItemResult,
  mergeFoodItems as dbMergeFoodItems,
  searchFoodItems as searchUserFoodItems,
  setFoodItemReference as dbSetFoodItemReference,
  updateFoodItem as dbUpdateFoodItem,
  upsertFoodItem,
} from '../db/food-items.ts'
import {
  getFoodItemSensitivities,
  setFoodItemSensitivities as dbSetFoodItemSensitivities,
} from '../db/sensitivities.ts'
import { getSharedFoodItemOverridesByIds } from '../db/shared-food-item-overrides.ts'

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
  /**
   * The portion (unit) the ingredient is measured in, when `row.food_item_portion_id`
   * is set and resolves. Null/absent on the legacy quantity/unit path or when the
   * portion was deleted (scaling then falls back / flags incomplete).
   */
  portion?: FoodItemPortionRow | null
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
  /** True when the item came from the central shared library — read-only, customizable only via the override endpoints. */
  is_shared: boolean
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
  /** Extra portion sizings defined for this food item, sorted by sort_order. */
  portions?: FoodItemPortionRow[]
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
 * Compute the scale factor for one resolved ingredient against its canonical
 * default_quantity.
 *
 * - Portion path (row.food_item_portion_id set + portion resolved): the count
 *   is in the portion's unit, so scale = `portion_count × base_equivalent /
 *   default_quantity` — mirrors the meal portion formula. A portion id that no
 *   longer resolves flips `incomplete` (the unit it referenced is gone).
 * - Legacy path: same units → straight ratio; dimensionally-compatible units
 *   (e.g. dl ↔ ml) → convert; anything else (mismatched dimension, missing
 *   default_quantity) → scale = 1 + incomplete flag.
 */
const computeIngredientScale = (ingredient: ResolvedIngredient): ScaleResult => {
  const { row, food, portion } = ingredient
  if (!food) return { incomplete: true, scale: 1 }
  const defaultQty = food.default_quantity as number | undefined
  if (defaultQty === undefined || defaultQty === null || defaultQty === 0) {
    return { incomplete: true, scale: 1 }
  }
  // Portion path.
  if (row.food_item_portion_id) {
    if (!portion || typeof row.portion_count !== 'number') return { incomplete: true, scale: 1 }
    return { incomplete: false, scale: (row.portion_count * portion.base_equivalent) / defaultQty }
  }
  // Legacy quantity/unit path.
  const defaultUnit = food.default_unit as string | undefined
  if (row.unit && defaultUnit && row.unit !== defaultUnit) {
    const converted = convertUnit(row.quantity, row.unit, defaultUnit)
    if (converted === undefined) return { incomplete: true, scale: 1 }
    return { incomplete: false, scale: converted / defaultQty }
  }
  return { incomplete: false, scale: row.quantity / defaultQty }
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
  // Only per-user atomic items reach reference enrichment — central rows
  // never carry a reference_food_item_id, so is_shared is always false here.
  return {
    item: self,
    is_shared: false,
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
  for (const ingredient of ingredients) {
    const { food } = ingredient
    if (!food) {
      incomplete = true
      continue
    }
    if (typeof food.calories !== 'number') incomplete = true
    const { scale, incomplete: scaleIncomplete } = computeIngredientScale(ingredient)
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

/**
 * Merge per-user overrides onto a list of central items. Central rows are
 * read-only (one canonical LSV entry serves every user), so user-specific
 * customizations live in `shared_food_item_overrides` and are layered in at
 * read time.
 *
 * `override.icon` semantics: a string sets the icon, `null` explicitly hides
 * the central icon (user picked "no icon"), and a missing override row falls
 * through to the central value untouched.
 */
const applySharedOverrides = async (
  user: string,
  items: SharedFoodItemEntity[],
): Promise<SharedFoodItemEntity[]> => {
  if (items.length === 0) return items
  const overrides = await getSharedFoodItemOverridesByIds(
    user,
    items.map((i) => i.id),
  )
  if (overrides.size === 0) return items
  return items.map((item) => {
    const override = overrides.get(item.id)
    if (!override) return item
    // Icon: pass through central UNLESS the user explicitly supplied a
    // value (string OR null). icon_overridden carries that bit; it's
    // false on rows where only other fields (e.g. default_portion_id)
    // were set, so the column-default NULL doesn't accidentally hide
    // the central icon.
    // default_portion_id: NULL = no override, pass through central
    // (currently no central default exists, but the semantic is clean).
    return {
      ...item,
      ...(override.icon_overridden ? { icon: override.icon ?? undefined } : {}),
      ...(override.default_portion_id ? { default_portion_id: override.default_portion_id } : {}),
      ...(override.default_log_quantity != null
        ? { default_log_quantity: override.default_log_quantity }
        : {}),
    }
  })
}

const applySharedOverride = async (
  user: string,
  item: SharedFoodItemEntity | null,
): Promise<SharedFoodItemEntity | null> => {
  if (!item) return item
  const [decorated] = await applySharedOverrides(user, [item])
  return decorated
}

export interface FoodItemDisplay {
  /** Current canonical name. */
  name: string
  /** Current canonical icon — central items have user override applied if set. */
  icon?: string
}

/**
 * Batch-resolve current name + icon for a set of food_item_ids. Looks first
 * in the per-user `food_items` table, then falls back to the central shared
 * library, then layers per-user icon overrides on top of central items.
 *
 * Used at meal read time (timeline + meal detail + frequent items) so the
 * UI sees the latest name/icon edits without depending on stale junction
 * snapshots. Ids that resolve nowhere are simply absent from the map —
 * callers can render a generic fallback for those.
 */
export const resolveFoodItemDisplay = async (
  user: string,
  centralDb: CentralDb,
  ids: string[],
): Promise<Map<string, FoodItemDisplay>> => {
  const map = new Map<string, FoodItemDisplay>()
  const unique = Array.from(new Set(ids))
  if (unique.length === 0) return map

  const userItems = await getUserFoodItemsByIds(user, unique)
  for (const [id, item] of userItems) {
    // FoodItemEntity widens unknown columns via its nutrient index signature;
    // the icon column is a plain optional string, so narrow it explicitly.
    map.set(id, { icon: item.icon as string | undefined, name: item.name })
  }

  const missing = unique.filter((id) => !map.has(id))
  if (missing.length === 0) return map

  // Fetch central items and overrides in parallel — overrides for ids that
  // don't resolve in central are simply absent from the returned map, so
  // widening the override scope to `missing` is harmless and saves a round
  // trip on cold timeline reads.
  const [centralItems, overrides] = await Promise.all([
    centralDb.getSharedFoodItemsByIds(missing),
    getSharedFoodItemOverridesByIds(user, missing),
  ])
  for (const [id, item] of centralItems) {
    const override = overrides.get(id)
    // override.icon === null means "explicit no icon" — pass through as undefined.
    const icon = override ? (override.icon ?? undefined) : item.icon
    map.set(id, { icon, name: item.name })
  }
  return map
}

export const createFoodItemsService = (centralDb: CentralDb): FoodItemsService => ({
  search: async (user, q, limit = 20) => {
    const [userItems, rawSharedItems] = await Promise.all([
      searchUserFoodItems(user, q, limit),
      centralDb.searchSharedFoodItems(q, limit),
    ])
    const sharedItems = await applySharedOverrides(user, rawSharedItems)
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
    return applySharedOverride(user, await centralDb.getSharedFoodItemById(id))
  },

  getByName: async (user, name) => {
    const fromUser = await getUserFoodItemByName(user, name)
    if (fromUser) return fromUser
    return applySharedOverride(user, await centralDb.getSharedFoodItemByName(name))
  },

  findOrCreate: async (user, name, defaults) => {
    // Prefer the central canonical entry over creating a per-user duplicate.
    // Exact name match only — fuzzy resolution would silently bind a meal to
    // the wrong food item.
    const central = await applySharedOverride(user, await centralDb.getSharedFoodItemByName(name))
    if (central) return central
    const fromUser = await getUserFoodItemByName(user, name)
    if (fromUser) return fromUser
    return findOrCreateUserFoodItem(user, name, defaults)
  },

  getDetail: async (user, id) => {
    // Sensitivity flags work for both per-user and central items — the
    // junction's food_item_id is a soft pointer, so a user can flag a
    // central LSV item just as easily as one of their own. Portions share
    // the same soft-pointer design, so the same id resolves regardless of
    // which library the food itself lives in.
    //
    // Both lookups run unconditionally and in parallel; the no-portion
    // case (likely common today) pays one extra empty SELECT to keep the
    // detail path single-round-trip with no branching. If detail becomes
    // hot, switch to a combined EXISTS query or denormalise a has_portions
    // flag — but don't reintroduce serial latency by gating one on the other.
    const [sensitivityFlags, portionRows] = await Promise.all([
      getFoodItemSensitivities(user, id),
      listPortionsForFoodItem(user, id),
    ])
    const sensitivities = sensitivityFlags.map((f) => ({ id: f.id, name: f.name, color: f.color ?? null }))
    // Always an array (empty when the item has no portions) so the detail
    // contract is `portions: FoodItemPortion[]` on every path — consumers can
    // rely on `.map`/`.length` without a null check (#780).
    const portions = portionRows

    const fromUser = await getUserFoodItemById(user, id)
    if (fromUser) {
      // Composite path takes precedence over reference enrichment — a
      // recipe's nutrients are entirely derived from its ingredients, so
      // a reference would be ignored anyway.
      if (fromUser.is_composite) {
        const rows = await dbGetIngredients(user, id)
        if (rows.length === 0) return { item: fromUser, is_shared: false, portions, sensitivities }
        // Resolve each ingredient: prefer the per-user row, fall back to the
        // central library. Once we know which ingredients came from central,
        // batch the override lookup so a 10-ingredient recipe makes one
        // override query instead of ten.
        const resolutions = await Promise.all(
          rows.map(async (row) => {
            const fromUserIng = await getUserFoodItemById(user, row.ingredient_food_item_id)
            if (fromUserIng) return { row, userFood: fromUserIng, centralFood: null }
            const fromCentralIng = await centralDb.getSharedFoodItemById(row.ingredient_food_item_id)
            return { row, userFood: null, centralFood: fromCentralIng }
          }),
        )
        const centralFoods = resolutions
          .map((r) => r.centralFood)
          .filter((f): f is SharedFoodItemEntity => f !== null)
        const decoratedCentral = await applySharedOverrides(user, centralFoods)
        const decoratedById = new Map(decoratedCentral.map((f) => [f.id, f]))
        // Resolve the portion (unit) for ingredients logged via a portion, so
        // scaling can use its base_equivalent. Batch the distinct ids.
        const portionIds = Array.from(
          new Set(rows.map((r) => r.food_item_portion_id).filter((p): p is string => !!p)),
        )
        const portionEntries = await Promise.all(
          portionIds.map(async (pid) => [pid, await getFoodItemPortionById(user, pid)] as const),
        )
        const portionById = new Map(
          portionEntries.filter((e): e is [string, FoodItemPortionRow] => e[1] !== null),
        )
        const resolved: ResolvedIngredient[] = resolutions.map(({ row, userFood, centralFood }) => ({
          food: userFood ?? (centralFood ? (decoratedById.get(centralFood.id) ?? null) : null),
          portion: row.food_item_portion_id ? (portionById.get(row.food_item_portion_id) ?? null) : null,
          row,
        }))
        return {
          derived_nutrients: aggregateNutrientsFromIngredients(resolved),
          ingredients: resolved,
          is_shared: false,
          item: fromUser,
          portions,
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
          (await getUserFoodItemById(user, refId)) ??
          (await applySharedOverride(user, await centralDb.getSharedFoodItemById(refId)))
        if (refFood && !refFood.is_composite) {
          return { ...enrichWithReference(fromUser, refFood), portions, sensitivities }
        }
      }
      return { item: fromUser, is_shared: false, portions, sensitivities }
    }
    const fromCentral = await applySharedOverride(user, await centralDb.getSharedFoodItemById(id))
    return fromCentral ? { item: fromCentral, is_shared: true, portions, sensitivities } : null
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

/**
 * Validate + normalise ingredient inputs before persisting, mirroring the meal
 * portion path (resolvePortionForInput + buildScaledJunctionItem):
 *
 * - For a portion-based ingredient, the portion must exist AND belong to the
 *   ingredient food item, and portion_count must be positive. The display
 *   columns are filled from the portion (`quantity = portion_count`,
 *   `unit = portion.label_unit`) so the row renders "2 brödkaka" even without
 *   re-fetching the portion, while scaling re-derives live from the portion id.
 * - For a legacy ingredient, quantity is required (the schema enforces this;
 *   we guard anyway).
 *
 * Throws on invalid portion references — callers surface it as a 400.
 */
export const prepareIngredientInputs = async (
  user: string,
  ingredients: FoodItemIngredient[],
): Promise<FoodItemIngredientInput[]> =>
  Promise.all(
    ingredients.map(async (ing, i): Promise<FoodItemIngredientInput> => {
      const sort_order = ing.sort_order ?? i
      if (ing.food_item_portion_id) {
        const portion = await getFoodItemPortionById(user, ing.food_item_portion_id)
        if (!portion) throw new Error(`Portion not found: ${ing.food_item_portion_id}`)
        if (portion.food_item_id !== ing.ingredient_food_item_id) {
          throw new Error(
            `Portion ${ing.food_item_portion_id} does not belong to food item ${ing.ingredient_food_item_id}`,
          )
        }
        if (typeof ing.portion_count !== 'number' || ing.portion_count <= 0) {
          throw new Error('portion_count must be a positive number when food_item_portion_id is set')
        }
        return {
          food_item_portion_id: ing.food_item_portion_id,
          ingredient_food_item_id: ing.ingredient_food_item_id,
          portion_count: ing.portion_count,
          quantity: ing.portion_count,
          sort_order,
          unit: portion.label_unit,
        }
      }
      if (typeof ing.quantity !== 'number') {
        throw new Error('quantity is required when no food_item_portion_id is set')
      }
      return {
        ingredient_food_item_id: ing.ingredient_food_item_id,
        quantity: ing.quantity,
        sort_order,
        unit: ing.unit,
      }
    }),
  )

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
// Duplicate a food item
// ============================================================================

/**
 * Find a free per-user name for a copy of `baseName`. Tries "<name> (copy)"
 * first, then "<name> (copy 2)", "(copy 3)", … so duplicating never collides
 * with — and thus silently overwrites via the name_lower upsert conflict — an
 * existing item. Only the per-user library is checked; central names live in
 * a separate database and never conflict with per-user inserts.
 *
 * The check is best-effort against concurrency: two duplicate calls racing on
 * the same source could each see the same name free, and the second's upsert
 * (ON CONFLICT (name_lower) DO UPDATE) would then overwrite the first's row
 * rather than insert a new one. Per-user, single-actor DBs make this vanishingly
 * rare — same as the concurrent-setIngredients note above — so we don't pay for
 * a fail-and-retry insert path here.
 */
const findAvailableCopyName = async (user: string, baseName: string): Promise<string> => {
  const first = `${baseName} (copy)`
  if (!(await getUserFoodItemByName(user, first))) return first
  for (let n = 2; n < 1000; n++) {
    const candidate = `${baseName} (copy ${n})`
    if (!(await getUserFoodItemByName(user, candidate))) return candidate
  }
  // Practically unreachable — 1000 copies of the same recipe. Fall back to a
  // timestamp suffix rather than throwing so the user still gets their copy.
  return `${baseName} (copy ${Date.now()})`
}

/**
 * Build the insert input for a copy: name + source/default_* + every numeric
 * nutrient column. For composites these nutrient values are the cached derived
 * totals; cacheCompositeNutrients recomputes them identically afterwards, so
 * copying them here is harmless and keeps the atomic path correct in one place.
 */
const buildFoodItemCopyInput = (source: MergedFoodItem, name: string): InsertFoodItemInput => {
  const input: InsertFoodItemInput = {
    name,
    source: 'manual',
    default_quantity: source.default_quantity as number | undefined,
    default_unit: source.default_unit as string | undefined,
    icon: source.icon as string | undefined,
  }
  for (const field of NUTRIENT_FIELD_NAMES) {
    const v = source[field]
    if (typeof v === 'number') input[field] = v
  }
  return input
}

/**
 * Recreate each source portion on the new food with a fresh id, returning the
 * old→new id map so a copied default_portion_id can be remapped onto the
 * copy's own portion rather than the source's.
 */
const copyPortionsToFood = async (
  user: string,
  portions: FoodItemPortionRow[],
  newId: string,
): Promise<Map<string, string>> => {
  const portionIdMap = new Map<string, string>()
  for (const portion of portions) {
    const inserted = await insertFoodItemPortion(user, {
      food_item_id: newId,
      label_unit: portion.label_unit,
      base_equivalent: portion.base_equivalent,
      sort_order: portion.sort_order,
    })
    portionIdMap.set(portion.id, inserted.id)
  }
  return portionIdMap
}

/**
 * Build the partial update carrying the copy's default-portion preselection.
 * `source.default_portion_id` is the per-user column or (for a central source)
 * the override-decorated value; it's remapped through `portionIdMap` to the
 * copy's own portion id.
 */
const buildDefaultPortionUpdate = (
  source: MergedFoodItem,
  portionIdMap: Map<string, string>,
): Record<string, unknown> => {
  const update: Record<string, unknown> = {}
  const sourceDefaultPortionId = source.default_portion_id as string | undefined
  const remapped = sourceDefaultPortionId ? portionIdMap.get(sourceDefaultPortionId) : undefined
  if (remapped) update.default_portion_id = remapped
  const logQuantity = source.default_log_quantity as number | undefined
  if (logQuantity !== undefined) update.default_log_quantity = logQuantity
  return update
}

/**
 * Duplicate a food item into a fresh per-user "manual" copy and return its
 * detail. Works for both per-user and central (shared library) sources — a
 * copy of a central LSV entry becomes an editable per-user fork, which is the
 * point of the feature: base a custom recipe on a canonical item, then tweak
 * one ingredient.
 *
 * What is copied:
 * - name → "<name> (copy)" (deduped, see findAvailableCopyName)
 * - nutrient columns + default_quantity/default_unit/icon
 * - composite ingredient list (then derived nutrients are re-cached)
 * - extra portions (new ids), with default_portion_id / default_log_quantity
 *   remapped onto the freshly-created portion rows
 * - reference_food_item_id (atomic items inheriting micronutrients)
 * - sensitivity flag assignments
 *
 * What is deliberately not copied: `source`/`source_id` provenance — the copy
 * is a user-authored fork, so it is plain `source: 'manual'` with no upstream
 * id. Returns null when the source id resolves nowhere.
 */
export const duplicateFoodItem = async (
  user: string,
  centralDb: CentralDb,
  sourceId: string,
): Promise<FoodItemDetail | null> => {
  const service = createFoodItemsService(centralDb)
  const detail = await service.getDetail(user, sourceId)
  if (!detail) return null
  const source = detail.item

  const name = await findAvailableCopyName(user, source.name as string)
  const created = await upsertFoodItem(user, buildFoodItemCopyInput(source, name))
  const newId = created.id

  // Composite ingredients — replace the (empty) list on the new row, then
  // refresh its cached derived nutrient columns.
  const ingredients = detail.ingredients ?? []
  if (ingredients.length > 0) {
    await dbSetIngredients(
      user,
      newId,
      ingredients.map((ing) => ({
        food_item_portion_id: ing.row.food_item_portion_id,
        ingredient_food_item_id: ing.row.ingredient_food_item_id,
        portion_count: ing.row.portion_count,
        quantity: ing.row.quantity,
        sort_order: ing.row.sort_order,
        unit: ing.row.unit,
      })),
    )
    await cacheCompositeNutrients(user, centralDb, newId)
  }

  const portionIdMap = await copyPortionsToFood(user, detail.portions ?? [], newId)
  const defaultsUpdate = buildDefaultPortionUpdate(source, portionIdMap)
  if (Object.keys(defaultsUpdate).length > 0) await dbUpdateFoodItem(user, newId, defaultsUpdate)

  // Reference pointer (atomic items only — composites can't have one).
  const referenceId = source.reference_food_item_id as string | undefined
  if (referenceId && ingredients.length === 0) await dbSetFoodItemReference(user, newId, referenceId)

  // Sensitivity flag assignments.
  const flagIds = (detail.sensitivities ?? []).map((s) => s.id)
  if (flagIds.length > 0) await dbSetFoodItemSensitivities(user, newId, flagIds)

  return service.getDetail(user, newId)
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
