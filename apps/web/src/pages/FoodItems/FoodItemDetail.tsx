import {
  type FoodItemDetail as ApiFoodItemDetail,
  type FoodItemIngredient,
  NUTRIENT_FIELDS,
  type NutrientFieldDef,
} from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useRoute } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import { ConfirmButton } from '../../components/ConfirmButton'
import { IconInput } from '../../components/IconInput'
import { type IngredientRow, IngredientList } from '../../components/IngredientList'
import { auth } from '../../state/auth'
import { isEmoji, isIconPath, isUrl } from '../../utils/emojiLookup'
import './FoodItemDetail.css'

const API_URL = import.meta.env.VITE_API_URL || '/api'

const fetchFoodItem = async (id: string): Promise<ApiFoodItemDetail> => {
  const { token } = auth.value
  const res = await fetch(`${API_URL}/food-items/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Food item not found')
  const json = await res.json()
  return json.data
}

const updateFoodItemApi = async (id: string, body: Record<string, unknown>): Promise<ApiFoodItemDetail> => {
  const { token } = auth.value
  const res = await fetch(`${API_URL}/food-items/${id}`, {
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    method: 'PATCH',
  })
  if (!res.ok) throw new Error('Update failed')
  const json = await res.json()
  return json.data
}

const deleteFoodItemApi = async (id: string): Promise<void> => {
  const { token } = auth.value
  const res = await fetch(`${API_URL}/food-items/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Delete failed')
}

const setIngredientsApi = async (
  id: string,
  ingredients: FoodItemIngredient[],
): Promise<ApiFoodItemDetail> => {
  const { token } = auth.value
  const res = await fetch(`${API_URL}/food-items/${id}/ingredients`, {
    body: JSON.stringify({ ingredients }),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    method: 'PUT',
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(json.error ?? 'Failed to update ingredients')
  }
  const json = await res.json()
  return json.data
}

const clearIngredientsApi = async (id: string): Promise<ApiFoodItemDetail> => {
  const { token } = auth.value
  const res = await fetch(`${API_URL}/food-items/${id}/ingredients`, {
    headers: { Authorization: `Bearer ${token}` },
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to clear ingredients')
  const json = await res.json()
  return json.data
}

const CATEGORIES: Array<{ key: NutrientFieldDef['category']; label: string }> = [
  { key: 'macro', label: 'Macros' },
  { key: 'extended_macro', label: 'Extended Macros' },
  { key: 'fat_breakdown', label: 'Fat Breakdown' },
  { key: 'vitamin', label: 'Vitamins' },
  { key: 'mineral', label: 'Minerals' },
  { key: 'amino_acid', label: 'Amino Acids' },
  { key: 'other', label: 'Other' },
]

function SaveIndicator({
  isPending,
  showSaved,
  error,
}: {
  isPending: boolean
  showSaved: boolean
  error: string | null
}) {
  if (error) return <span class="save-status save-error">⚠ {error}</span>
  if (isPending) return <span class="save-status save-pending">Saving…</span>
  if (showSaved) return <span class="save-status save-ok">Saved ✓</span>
  return null
}

function NutrientInput({
  field,
  initial,
  onCommit,
}: {
  field: NutrientFieldDef
  initial: number | undefined
  onCommit: (value: number | null) => void
}) {
  const [local, setLocal] = useState<string>(initial !== undefined ? String(initial) : '')

  useEffect(() => {
    setLocal(initial !== undefined ? String(initial) : '')
  }, [initial])

  const handleBlur = () => {
    const trimmed = local.trim()
    if (trimmed === '') {
      if (initial !== undefined) onCommit(null)
      return
    }
    const parsed = parseFloat(trimmed)
    if (Number.isNaN(parsed)) {
      // Revert to last good value rather than blanking the saved nutrient.
      setLocal(initial !== undefined ? String(initial) : '')
      return
    }
    if (parsed !== initial) onCommit(parsed)
  }

  return (
    <span class="nutrient-edit">
      <input
        type="number"
        step="0.01"
        value={local}
        onInput={(e) => setLocal((e.target as HTMLInputElement).value)}
        onBlur={handleBlur}
      />
      <span class="nutrient-unit">{field.unit}</span>
    </span>
  )
}

export function FoodItemDetail() {
  const { params } = useRoute()
  const { route } = useLocation()
  const queryClient = useQueryClient()
  const id = params.id

  const { data: item, isLoading } = useQuery({
    queryFn: () => fetchFoodItem(id),
    queryKey: ['foodItem', id],
  })

  const [name, setName] = useState('')
  const [defaultQuantity, setDefaultQuantity] = useState<string>('')
  const [defaultUnit, setDefaultUnit] = useState<string>('')
  const [icon, setIcon] = useState<string>('')

  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => void queryClient.invalidateQueries({ queryKey: ['foodItems'] }), [queryClient])
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    },
    [],
  )

  // Re-seed local state only when we navigate to a different food item.
  // On post-save refetches, item.id is stable so this skips — keeping any
  // field the user is mid-edit from being clobbered by the new server data.
  useEffect(() => {
    if (!item) return
    setName(item.name)
    setDefaultQuantity(item.default_quantity !== undefined ? String(item.default_quantity) : '')
    setDefaultUnit(item.default_unit ?? '')
    setIcon(item.icon ?? '')
  }, [item?.id])

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateFoodItemApi(id, body),
    onError: (err: Error) => setSaveError(err.message ?? 'Save failed'),
    onSuccess: (updated) => {
      // Seed the cache directly instead of invalidating, so we don't trigger
      // a refetch that could race with another in-flight blur/edit.
      queryClient.setQueryData(['foodItem', id], updated)
      queryClient.invalidateQueries({ queryKey: ['foodItems'] })
      setSaveError(null)
      setSavedFlash(true)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setSavedFlash(false), 1200)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteFoodItemApi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodItems'] })
      route('/food-items')
    },
  })

  const ingredientsMutation = useMutation({
    mutationFn: (ingredients: FoodItemIngredient[]) => setIngredientsApi(id, ingredients),
    onError: (err: Error) => setSaveError(err.message ?? 'Save failed'),
    onSuccess: (updated) => {
      queryClient.setQueryData(['foodItem', id], updated)
      setSaveError(null)
      setSavedFlash(true)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setSavedFlash(false), 1200)
    },
  })

  const clearMutation = useMutation({
    mutationFn: () => clearIngredientsApi(id),
    onError: (err: Error) => setSaveError(err.message ?? 'Save failed'),
    onSuccess: (updated) => {
      queryClient.setQueryData(['foodItem', id], updated)
      setSaveError(null)
      setSavedFlash(true)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setSavedFlash(false), 1200)
    },
  })

  const save = (body: Record<string, unknown>) => {
    setSaveError(null)
    updateMutation.mutate(body)
  }

  if (isLoading) {
    return (
      <div class="food-item-detail-page">
        <p class="loading">Loading...</p>
      </div>
    )
  }
  if (!item) {
    return (
      <div class="food-item-detail-page">
        <p>Food item not found.</p>
      </div>
    )
  }

  const commitName = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setName(item.name)
      return
    }
    if (trimmed !== item.name) save({ name: trimmed })
  }

  const commitDefaultQuantity = () => {
    const trimmed = defaultQuantity.trim()
    if (trimmed === '') {
      if (item.default_quantity !== undefined) save({ default_quantity: null })
      return
    }
    const parsed = parseFloat(trimmed)
    if (Number.isNaN(parsed)) {
      setDefaultQuantity(item.default_quantity !== undefined ? String(item.default_quantity) : '')
      return
    }
    if (parsed !== item.default_quantity) save({ default_quantity: parsed })
  }

  const commitDefaultUnit = () => {
    const trimmed = defaultUnit.trim()
    const current = item.default_unit ?? ''
    if (trimmed === current) return
    save({ default_unit: trimmed || null })
  }

  const commitIcon = () => {
    const next = icon.trim() || null
    const current = item.icon ?? null
    if (next === current) return
    save({ icon: next })
  }

  return (
    <div class="food-item-detail-page">
      <div class="fi-detail-header">
        <a href="/food-items" class="back-link">
          &larr; Food Items
        </a>
        <div class="fi-detail-actions">
          <SaveIndicator isPending={updateMutation.isPending} showSaved={savedFlash} error={saveError} />
          <ConfirmButton
            label="Delete"
            confirmMessage={`Delete ${item.name}?`}
            onConfirm={() => deleteMutation.mutate()}
            isPending={deleteMutation.isPending}
          />
        </div>
      </div>

      <h1 class="fi-name-heading">
        {item.icon && isEmoji(item.icon) && <span class="fi-icon-display">{item.icon}</span>}
        {item.icon && (isUrl(item.icon) || isIconPath(item.icon)) && (
          <img src={item.icon} alt="" width={24} height={24} class="fi-icon-display-img" />
        )}
        <input
          type="text"
          class="fi-name-input"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          onBlur={commitName}
        />
      </h1>

      <div class="fi-icon-row">
        <label class="fi-icon-label">Icon</label>
        <IconInput value={icon} onChange={setIcon} onBlur={commitIcon} />
      </div>

      <div class="fi-meta">
        {item.source && <span class="fi-source">Source: {item.source}</span>}
        <span class="fi-default-edit">
          Default:
          <input
            type="number"
            step="0.1"
            value={defaultQuantity}
            placeholder="Qty"
            onInput={(e) => setDefaultQuantity((e.target as HTMLInputElement).value)}
            onBlur={commitDefaultQuantity}
          />
          <input
            type="text"
            value={defaultUnit}
            placeholder="Unit"
            onInput={(e) => setDefaultUnit((e.target as HTMLInputElement).value)}
            onBlur={commitDefaultUnit}
          />
        </span>
      </div>

      <CompositeOrAtomicSection
        item={item}
        ingredientsMutation={ingredientsMutation}
        clearMutation={clearMutation}
        save={save}
      />
    </div>
  )
}

interface CompositeProps {
  item: ApiFoodItemDetail
  ingredientsMutation: { mutate: (ingredients: FoodItemIngredient[]) => void; isPending: boolean }
  clearMutation: { mutate: () => void; isPending: boolean }
  save: (body: Record<string, unknown>) => void
}

function CompositeOrAtomicSection({ item, ingredientsMutation, clearMutation, save }: CompositeProps) {
  // Local state for atomic→composite intent: clicking "Convert to recipe"
  // surfaces the IngredientList immediately even before any ingredient is
  // saved. The is_composite flag flips server-side only when a non-empty
  // list is persisted.
  const [showAsComposite, setShowAsComposite] = useState(false)
  const isComposite = !!item.is_composite || (item.ingredients?.length ?? 0) > 0 || showAsComposite

  if (isComposite) {
    const initial: IngredientRow[] = (item.ingredients ?? []).map((ing) => ({
      icon: ing.icon,
      ingredient_food_item_id: ing.ingredient_food_item_id,
      name: ing.name,
      quantity: ing.quantity,
      sort_order: ing.sort_order ?? 0,
      unit: ing.unit,
    }))

    const persist = (rows: IngredientRow[]) => {
      ingredientsMutation.mutate(
        rows.map((r) => ({
          ingredient_food_item_id: r.ingredient_food_item_id,
          quantity: r.quantity,
          sort_order: r.sort_order,
          unit: r.unit,
        })),
      )
    }

    return (
      <>
        <div class="nutrient-section">
          <div class="composite-header">
            <h3>Ingredients</h3>
            <ConfirmButton
              label="Revert to atomic"
              confirmMessage="This will remove all ingredients and the item will use whatever nutrient values are stored on it directly. Continue?"
              onConfirm={() => {
                setShowAsComposite(false)
                clearMutation.mutate()
              }}
              isPending={clearMutation.isPending}
              buttonClass="btn-secondary"
            />
          </div>
          <IngredientList ingredients={initial} onChange={persist} />
        </div>

        <div class="nutrient-sections">
          <p class="composite-derived-note">
            Nutrient values below are derived from the ingredients × quantity. Edit the ingredients to change
            them.
          </p>
          {item.derived_nutrients?.nutrient_data_incomplete && (
            <p class="composite-incomplete">
              ⚠ One or more ingredients lack calorie data — totals may be understated.
            </p>
          )}
          {CATEGORIES.map(({ key, label }) => {
            const fields = NUTRIENT_FIELDS.filter((f) => f.category === key)
            const populated = fields.filter((f) => typeof item.derived_nutrients?.values[f.name] === 'number')
            if (populated.length === 0) return null
            return (
              <div key={key} class="nutrient-section">
                <h3>{label}</h3>
                <div class="nutrient-grid">
                  {populated.map((f) => (
                    <div key={f.name} class="nutrient-row">
                      <span class="nutrient-label">{f.label}</span>
                      <span class="nutrient-value">
                        {(item.derived_nutrients?.values[f.name] as number).toFixed(2)} {f.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </>
    )
  }

  return (
    <>
      <div class="composite-toggle-row">
        <button
          type="button"
          class="btn-secondary"
          onClick={() => setShowAsComposite(true)}
          disabled={ingredientsMutation.isPending}
        >
          Convert to recipe
        </button>
        <span class="composite-toggle-hint">
          Build this item from other foods — its nutrients will be summed from the ingredients.
        </span>
      </div>

      <div class="nutrient-sections">
        {CATEGORIES.map(({ key, label }) => {
          const fields = NUTRIENT_FIELDS.filter((f) => f.category === key)
          if (fields.length === 0) return null
          return (
            <div key={key} class="nutrient-section">
              <h3>{label}</h3>
              <div class="nutrient-grid">
                {fields.map((f) => {
                  const value = item[f.name as keyof ApiFoodItemDetail]
                  return (
                    <div key={f.name} class="nutrient-row">
                      <span class="nutrient-label">{f.label}</span>
                      <NutrientInput
                        field={f}
                        initial={typeof value === 'number' ? value : undefined}
                        onCommit={(v) => save({ [f.name]: v })}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
