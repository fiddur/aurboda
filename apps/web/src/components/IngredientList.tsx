/**
 * Ingredient editor for composite (recipe-style) food items.
 *
 * Each row is one ingredient pointing at another food item — picked via
 * FoodItemAutocomplete (which already merges user + central library), with
 * inline quantity and unit. Edits commit on **blur** (or remove); the
 * parent page persists the full list via PUT /food-items/:id/ingredients.
 */

import { useEffect, useState } from 'preact/hooks'

import type { FoodItemEntity } from '../state/api'

import { FoodItemAutocomplete } from './FoodItemAutocomplete'
import './IngredientList.css'

export interface IngredientRow {
  ingredient_food_item_id: string
  /** Display name resolved from the canonical food item (snapshotted from server response). */
  name: string | null
  icon: string | null
  quantity: number
  unit?: string
  sort_order: number
}

interface Props {
  ingredients: IngredientRow[]
  /** Called when the list changes — caller persists via PUT /food-items/:id/ingredients. */
  onChange: (ingredients: IngredientRow[]) => void
}

/**
 * One ingredient row with local qty/unit state that commits to the parent
 * on blur. Without this, every keystroke would fire a PUT — wasteful and,
 * with non-atomic writes, race-prone.
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
  const [qtyInput, setQtyInput] = useState<string>(String(ingredient.quantity))
  const [unitInput, setUnitInput] = useState<string>(ingredient.unit ?? '')

  // Re-sync local state if the server-side row changes (e.g. revert/refresh).
  useEffect(() => {
    setQtyInput(String(ingredient.quantity))
  }, [ingredient.quantity])
  useEffect(() => {
    setUnitInput(ingredient.unit ?? '')
  }, [ingredient.unit])

  const commitQty = () => {
    const trimmed = qtyInput.trim()
    if (trimmed === '') {
      // Empty input → revert; clearing the field shouldn't silently set to 0.
      setQtyInput(String(ingredient.quantity))
      return
    }
    const parsed = parseFloat(trimmed)
    if (Number.isNaN(parsed)) {
      setQtyInput(String(ingredient.quantity))
      return
    }
    if (parsed !== ingredient.quantity) onCommit({ quantity: parsed })
  }

  const commitUnit = () => {
    const next = unitInput.trim() || undefined
    if (next !== ingredient.unit) onCommit({ unit: next })
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
      <input
        type="text"
        value={unitInput}
        placeholder="unit"
        class="ingredient-unit"
        onInput={(e) => setUnitInput((e.target as HTMLInputElement).value)}
        onBlur={commitUnit}
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
