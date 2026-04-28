/**
 * Ingredient editor for composite (recipe-style) food items.
 *
 * Each row is one ingredient pointing at another food item — picked via
 * FoodItemAutocomplete (which already merges user + central library), with
 * inline quantity and unit. Edits commit on blur; the parent page persists
 * the full list via PUT /food-items/:id/ingredients.
 */

import { useState } from 'preact/hooks'

import type { FoodItemEntity } from '../state/api'

import './IngredientList.css'
import { FoodItemAutocomplete } from './FoodItemAutocomplete'

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

export function IngredientList({ ingredients, onChange }: Props) {
  // Mirror of incoming list with one trailing blank row for adding.
  const [draft, setDraft] = useState('')

  const updateAt = (index: number, patch: Partial<IngredientRow>) => {
    const next = ingredients.map((ing, i) => (i === index ? { ...ing, ...patch } : ing))
    onChange(next)
  }

  const removeAt = (index: number) => {
    const next = ingredients.filter((_, i) => i !== index).map((ing, i) => ({ ...ing, sort_order: i }))
    onChange(next)
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
        <div key={ing.ingredient_food_item_id || i} class="ingredient-row">
          <span class="ingredient-name">
            {ing.icon && <span class="ingredient-icon">{ing.icon}</span>}
            {ing.name ?? <em class="ingredient-missing">(unresolved)</em>}
          </span>
          <input
            type="number"
            step="0.1"
            value={ing.quantity}
            class="ingredient-qty"
            onInput={(e) => {
              const v = parseFloat((e.target as HTMLInputElement).value)
              if (!Number.isNaN(v)) updateAt(i, { quantity: v })
            }}
          />
          <input
            type="text"
            value={ing.unit ?? ''}
            placeholder="unit"
            class="ingredient-unit"
            onInput={(e) => updateAt(i, { unit: (e.target as HTMLInputElement).value || undefined })}
          />
          <button
            type="button"
            class="btn-danger-small"
            onClick={() => removeAt(i)}
            title="Remove ingredient"
          >
            &times;
          </button>
        </div>
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
