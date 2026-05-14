import type { UpdateMealBody } from '@aurboda/api-spec'

export interface FoodItemRef {
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
  quantity?: number
  unit?: string
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
    .map((fi) => ({
      food_item_id: fi.food_item_id,
      name: fi.name,
      quantity: fi.quantity,
      unit: fi.unit,
    }))

/** Linearly scale a reference nutrient value to the current quantity. */
export const scaleNutrient = (
  ref: FoodItemRef | undefined,
  field: keyof Omit<FoodItemRef, 'quantity'>,
  currentQuantity: number | undefined,
): number | undefined => {
  if (!ref) return undefined
  const baseValue = ref[field]
  if (typeof baseValue !== 'number') return undefined
  if (ref.quantity === undefined || ref.quantity === 0) return baseValue
  if (currentQuantity === undefined) return baseValue
  return Math.round(((baseValue * currentQuantity) / ref.quantity) * 10) / 10
}
