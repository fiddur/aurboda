/**
 * Ingredient editor for composite (recipe-style) food items.
 *
 * Each row is one ingredient pointing at another food item — picked via
 * FoodItemAutocomplete (which already merges user + central library), with an
 * inline quantity and a unit picker. The unit picker offers the ingredient
 * food's base unit plus any portions it defines (e.g. "brödkaka"), mirroring
 * the meal logging UI: when a portion is selected the number is `portion_count`
 * and the recipe scales by `portion_count × base_equivalent / default_quantity`.
 * Edits commit on **blur** (or pick/remove); the parent page persists the full
 * list via PUT /food-items/:id/ingredients.
 */

import type { FoodItemPortion } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'

import { type FoodItemEntity, fetchFoodItemDetailApi } from '../state/api'
import { FoodItemAutocomplete } from './FoodItemAutocomplete'
import './IngredientList.css'

export interface IngredientRow {
  ingredient_food_item_id: string
  /** Display name resolved from the canonical food item (snapshotted from server response). */
  name: string | null
  icon: string | null
  quantity: number
  unit?: string
  /** When set, the ingredient is measured in this portion (unit) of the ingredient food. */
  food_item_portion_id?: string
  /** The count entered in the portion's unit (paired with food_item_portion_id). */
  portion_count?: number
  sort_order: number
}

interface Props {
  ingredients: IngredientRow[]
  /** Called when the list changes — caller persists via PUT /food-items/:id/ingredients. */
  onChange: (ingredients: IngredientRow[]) => void
}

// Unit dropdown for an ingredient: the base unit is value "", each portion of
// the ingredient food is a bare named unit (the count lives in the qty input).
function UnitPicker({
  selectedId,
  portions,
  baseUnitLabel,
  onPick,
}: {
  selectedId: string | undefined
  portions: FoodItemPortion[]
  baseUnitLabel: string
  onPick: (portionId: string) => void
}) {
  return (
    <select
      class="ingredient-portion-picker"
      value={selectedId ?? ''}
      onChange={(e) => onPick((e.target as HTMLSelectElement).value)}
    >
      <option value="">{baseUnitLabel}</option>
      {portions.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label_unit}
        </option>
      ))}
    </select>
  )
}

/**
 * One ingredient row with local qty state that commits to the parent on blur.
 * Without this, every keystroke would fire a PUT — wasteful and, with
 * non-atomic writes, race-prone. The unit picker commits immediately on change.
 */
function IngredientRowEditor({
  ingredient,
  onCommit,
  onRemove,
}: {
  ingredient: IngredientRow
  onCommit: (patch: Partial<IngredientRow>) => void
  onRemove: () => void
}) {
  const isPortion = !!ingredient.food_item_portion_id
  const effectiveQty = isPortion ? ingredient.portion_count : ingredient.quantity
  const [qtyInput, setQtyInput] = useState<string>(effectiveQty === undefined ? '' : String(effectiveQty))

  // Re-sync local state when the row's effective quantity changes (e.g. unit
  // switch carries the number, or a server refresh/revert).
  useEffect(() => {
    setQtyInput(effectiveQty === undefined ? '' : String(effectiveQty))
  }, [effectiveQty])

  // Fetch the ingredient food's detail for its available portions + base unit.
  // Cached by react-query keyed on the id, so re-renders don't re-fetch.
  const { data: detail } = useQuery({
    enabled: !!ingredient.ingredient_food_item_id,
    queryFn: () => fetchFoodItemDetailApi(ingredient.ingredient_food_item_id),
    queryKey: ['foodItem', ingredient.ingredient_food_item_id],
  })
  const portions = detail?.portions ?? []
  const baseUnitLabel = detail?.default_unit || 'unit'

  const commitQty = () => {
    const trimmed = qtyInput.trim()
    if (trimmed === '') {
      // Empty input → revert; clearing the field shouldn't silently set to 0.
      setQtyInput(effectiveQty === undefined ? '' : String(effectiveQty))
      return
    }
    const parsed = parseFloat(trimmed)
    if (Number.isNaN(parsed)) {
      setQtyInput(effectiveQty === undefined ? '' : String(effectiveQty))
      return
    }
    if (parsed === effectiveQty) return
    onCommit(isPortion ? { portion_count: parsed } : { quantity: parsed })
  }

  // Switching unit carries the number the user already typed: base→portion
  // carries `quantity`, portion→portion carries `portion_count`.
  const handlePortionPick = (portionId: string) => {
    const carried = ingredient.portion_count ?? ingredient.quantity
    if (!portionId) {
      onCommit({
        food_item_portion_id: undefined,
        portion_count: undefined,
        quantity: carried ?? detail?.default_quantity ?? 1,
        unit: detail?.default_unit ?? ingredient.unit,
      })
      return
    }
    const p = portions.find((pp) => pp.id === portionId)
    if (!p) return
    onCommit({
      food_item_portion_id: p.id,
      portion_count: carried ?? 1,
      unit: p.label_unit,
    })
  }

  return (
    <div class="ingredient-row">
      <span class="ingredient-name">
        {ingredient.icon && <span class="ingredient-icon">{ingredient.icon}</span>}
        {ingredient.name ?? <em class="ingredient-missing">(unresolved)</em>}
      </span>
      <input
        type="number"
        step="0.1"
        value={qtyInput}
        class="ingredient-qty"
        onInput={(e) => setQtyInput((e.target as HTMLInputElement).value)}
        onBlur={commitQty}
      />
      <UnitPicker
        selectedId={ingredient.food_item_portion_id}
        portions={portions}
        baseUnitLabel={baseUnitLabel}
        onPick={handlePortionPick}
      />
      <button type="button" class="btn-danger-small" onClick={onRemove} title="Remove ingredient">
        &times;
      </button>
    </div>
  )
}

export function IngredientList({ ingredients, onChange }: Props) {
  // Autocomplete input string — independent of the persisted ingredient list.
  const [draft, setDraft] = useState('')

  const updateAt = (index: number, patch: Partial<IngredientRow>) => {
    onChange(ingredients.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)))
  }

  const removeAt = (index: number) => {
    onChange(ingredients.filter((_, i) => i !== index).map((ing, i) => ({ ...ing, sort_order: i })))
  }

  const handleAdd = (item: FoodItemEntity) => {
    const next: IngredientRow = {
      icon: (item.icon as string | null) ?? null,
      ingredient_food_item_id: item.id,
      name: item.name,
      quantity: (item.default_quantity as number | undefined) ?? 1,
      sort_order: ingredients.length,
      unit: (item.default_unit as string | undefined) ?? undefined,
    }
    onChange([...ingredients, next])
    setDraft('')
  }

  return (
    <div class="ingredient-list">
      {ingredients.length === 0 && <p class="ingredient-empty">No ingredients yet.</p>}
      {ingredients.map((ing, i) => (
        <IngredientRowEditor
          key={ing.ingredient_food_item_id || i}
          ingredient={ing}
          onCommit={(patch) => updateAt(i, patch)}
          onRemove={() => removeAt(i)}
        />
      ))}
      <div class="ingredient-add-row">
        <FoodItemAutocomplete
          value={draft}
          onChange={setDraft}
          onSelect={handleAdd}
          placeholder="Add ingredient — search the library…"
        />
      </div>
    </div>
  )
}
