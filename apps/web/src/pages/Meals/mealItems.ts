import type { UpdateMealBody } from '@aurboda/api-spec'

export interface FoodItemRef {
  /**
   * Canonical default quantity — the denominator for legacy-path scaling
   * (`nutrient × currentQuantity / quantity`).
   */
  quantity?: number
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
}

export interface FoodItemEdit {
  food_item_id?: string
  name: string
  /** Free-form quantity (legacy path) — ignored when food_item_portion_id is set. */
  quantity?: number
  unit?: string
  /**
   * When set, the row is logged via the portion path: nutrients scale by
   * `portion_count × portion.base_equivalent / canonical.default_quantity`.
   */
  food_item_portion_id?: string
  /** Count of `food_item_portion_id` portions logged. Required when portion_id is set. */
  portion_count?: number
  /**
   * Snapshot of the chosen portion's label_quantity × label_unit and
   * base_equivalent, kept on the edit row so display + live scaling don't
   * have to re-look-up the food. Cleared when the user reverts to the
   * base/free-form path.
   */
  portion?: { label_quantity: number; label_unit: string; base_equivalent: number }
  /**
   * Reference values for live display scaling. Captured at row creation
   * (autocomplete pick: canonical default_quantity + canonical nutrients;
   * existing item edit: server snapshot quantity + snapshot nutrients).
   * Stripped before save — the backend re-derives the snapshot from the
   * canonical food item × quantity.
   */
  ref?: FoodItemRef
}

export const mealItemsToEdit = (
  items?: {
    name: string
    food_item_id?: string
    food_item_portion_id?: string
    portion_count?: number
    quantity?: number
    unit?: string
    calories?: number
    protein?: number
    carbs?: number
    fat?: number
    fiber?: number
  }[],
): FoodItemEdit[] =>
  (items ?? []).map((fi) => ({
    food_item_id: fi.food_item_id,
    food_item_portion_id: fi.food_item_portion_id,
    portion_count: fi.portion_count,
    name: fi.name,
    quantity: fi.quantity,
    ref: {
      calories: fi.calories,
      carbs: fi.carbs,
      fat: fi.fat,
      fiber: fi.fiber,
      protein: fi.protein,
      quantity: fi.quantity,
    },
    unit: fi.unit,
  }))

/**
 * Build the food_items payload for an UpdateMeal request.
 *
 * Rows without `food_item_id` are treated as in-progress drafts (the user
 * is still typing in the autocomplete and hasn't picked or created a
 * canonical food item) and are excluded. This prevents the backend's
 * findOrCreate path from being triggered implicitly by autosaved keystrokes
 * — each partial name would otherwise become a new canonical food item
 * (e.g. "A", "As", "Ask", "Asko"…). Creation must go through the explicit
 * "+ Create" path in the autocomplete dropdown.
 */
export const editItemsToBody = (items: FoodItemEdit[]): UpdateMealBody['food_items'] =>
  items
    .filter((fi) => fi.food_item_id && fi.name.trim())
    .map((fi) =>
      fi.food_item_portion_id && typeof fi.portion_count === 'number'
        ? {
            food_item_id: fi.food_item_id,
            food_item_portion_id: fi.food_item_portion_id,
            portion_count: fi.portion_count,
            name: fi.name,
          }
        : {
            food_item_id: fi.food_item_id,
            name: fi.name,
            quantity: fi.quantity,
            unit: fi.unit,
          },
    )

/**
 * Linearly scale a reference nutrient value to the current quantity.
 *
 * Two paths, mirroring the backend:
 *   - Portion path (preferred when `portion` + `portion_count` are present):
 *     `nutrient × portion_count × portion.base_equivalent / ref.quantity`
 *     (ref.quantity is the canonical default_quantity — the denominator
 *     the canonical nutrient values are reported against.)
 *   - Legacy path: `nutrient × currentQuantity / ref.quantity` (same-unit
 *     assumption; the backend skips scaling if units don't match — the UI
 *     mirrors the simple ratio for display).
 */
export const scaleNutrient = (
  ref: FoodItemRef | undefined,
  field: keyof Omit<FoodItemRef, 'quantity'>,
  currentQuantity: number | undefined,
  portionScale?: { count: number; base_equivalent: number },
): number | undefined => {
  if (!ref) return undefined
  const baseValue = ref[field]
  if (typeof baseValue !== 'number') return undefined
  if (ref.quantity === undefined || ref.quantity === 0) return baseValue
  if (portionScale) {
    return (
      Math.round(((baseValue * portionScale.count * portionScale.base_equivalent) / ref.quantity) * 10) / 10
    )
  }
  if (currentQuantity === undefined) return baseValue
  return Math.round(((baseValue * currentQuantity) / ref.quantity) * 10) / 10
}
