import {
  type FoodItemDetail as ApiFoodItemDetail,
  type FoodItemIngredient,
  type FoodItemPortion,
  NUTRIENT_FIELDS,
  type NutrientFieldDef,
} from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useRoute } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import { ConfirmButton } from '../../components/ConfirmButton'
import { FoodItemAutocomplete } from '../../components/FoodItemAutocomplete'
import { IconInput } from '../../components/IconInput'
import { type IngredientRow, IngredientList } from '../../components/IngredientList'
import {
  addFoodItemPortionApi,
  deleteFoodItemPortionApi,
  duplicateFoodItemApi,
  setDefaultPortionApi,
  updateFoodItemPortionApi,
} from '../../state/api/meals'
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

const resnapshotMealsApi = async (id: string): Promise<{ meals_updated: number; rows_updated: number }> => {
  const { token } = auth.value
  const res = await fetch(`${API_URL}/food-items/${id}/resnapshot-meals`, {
    headers: { Authorization: `Bearer ${token}` },
    method: 'POST',
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(json.error ?? 'Re-snapshot failed')
  }
  const json = await res.json()
  return json.data
}

const setSharedIconOverrideApi = async (id: string, icon: string | null): Promise<void> => {
  const { token } = auth.value
  // Clearing the icon → DELETE the whole override row (matches the
  // "revert to central" semantic the user expects from blanking the field).
  // Setting an icon → PUT with `{ icon }`. We never call PATCH on a shared row.
  const init: RequestInit =
    icon === null
      ? { headers: { Authorization: `Bearer ${token}` }, method: 'DELETE' }
      : {
          body: JSON.stringify({ icon }),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          method: 'PUT',
        }
  const res = await fetch(`${API_URL}/food-items/${id}/override`, init)
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(json.error ?? 'Failed to update icon override')
  }
}

const setReferenceApi = async (id: string, referenceId: string | null): Promise<ApiFoodItemDetail> => {
  const { token } = auth.value
  const init: RequestInit =
    referenceId === null
      ? { headers: { Authorization: `Bearer ${token}` }, method: 'DELETE' }
      : {
          body: JSON.stringify({ reference_food_item_id: referenceId }),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          method: 'PUT',
        }
  const res = await fetch(`${API_URL}/food-items/${id}/reference`, init)
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(json.error ?? 'Failed to set reference')
  }
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
  inheritedValue,
  onCommit,
}: {
  field: NutrientFieldDef
  initial: number | undefined
  /** If set, the value comes from the reference. Shown as placeholder; user typing turns it into a self value. */
  inheritedValue?: number
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
      setLocal(initial !== undefined ? String(initial) : '')
      return
    }
    if (parsed !== initial) onCommit(parsed)
  }

  const isInherited = initial === undefined && inheritedValue !== undefined
  const placeholder = inheritedValue !== undefined ? String(inheritedValue) : undefined

  return (
    <span class={`nutrient-edit${isInherited ? ' nutrient-edit-inherited' : ''}`}>
      <input
        type="number"
        step="0.01"
        value={local}
        placeholder={placeholder}
        onInput={(e) => setLocal((e.target as HTMLInputElement).value)}
        onBlur={handleBlur}
      />
      <span class="nutrient-unit">{field.unit}</span>
      {isInherited && (
        <span class="nutrient-origin-badge" title="Value inherited from reference food">
          ref
        </span>
      )}
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

  const sharedIconMutation = useMutation({
    mutationFn: (next: string | null) => setSharedIconOverrideApi(id, next),
    onError: (err: Error) => setSaveError(err.message ?? 'Save failed'),
    onSuccess: () => {
      // The override endpoints don't echo back the merged detail, so refetch
      // to pick up the new effective icon (and any other override fields
      // surfaced later).
      queryClient.invalidateQueries({ queryKey: ['foodItem', id] })
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

  const duplicateMutation = useMutation({
    mutationFn: () => duplicateFoodItemApi(id),
    onError: (err: Error) => setSaveError(err.message ?? 'Duplicate failed'),
    onSuccess: (copy) => {
      // Seed the new copy's detail so its page renders without a refetch, then
      // navigate there so the user can immediately tweak the one ingredient
      // they wanted to change.
      queryClient.setQueryData(['foodItem', copy.id], copy)
      queryClient.invalidateQueries({ queryKey: ['foodItems'] })
      route(`/food-items/${copy.id}`)
    },
  })

  const [resnapshotResult, setResnapshotResult] = useState<{
    meals_updated: number
    rows_updated: number
  } | null>(null)
  const resnapshotMutation = useMutation({
    mutationFn: () => resnapshotMealsApi(id),
    onError: (err: Error) => setSaveError(err.message ?? 'Re-snapshot failed'),
    onSuccess: (result) => {
      setResnapshotResult(result)
      setSaveError(null)
      // Stale meals queries: a meal page open in another tab would still show
      // old totals — invalidate so any open meal/timeline view refreshes.
      queryClient.invalidateQueries({ queryKey: ['meals'] })
      queryClient.invalidateQueries({ queryKey: ['meal'] })
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

  const referenceMutation = useMutation({
    mutationFn: (referenceId: string | null) => setReferenceApi(id, referenceId),
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
    // Central library rows can't be PATCHed — icon edits go through the
    // per-user override layer. Other fields (name, default_*, nutrients) are
    // hidden in the UI for shared rows since they have no override slot yet.
    if (item.is_shared) {
      sharedIconMutation.mutate(next)
      return
    }
    save({ icon: next })
  }

  const isShared = !!item.is_shared
  const savePending = updateMutation.isPending || sharedIconMutation.isPending

  return (
    <div class="food-item-detail-page">
      <div class="fi-detail-header">
        <a href="/food-items" class="back-link">
          &larr; Food Items
        </a>
        <div class="fi-detail-actions">
          <SaveIndicator isPending={savePending} showSaved={savedFlash} error={saveError} />
          <ConfirmButton
            label={resnapshotMutation.isPending ? 'Re-snapshotting…' : 'Re-snapshot meals'}
            confirmMessage={`Refresh every past meal containing "${item.name}" with the current nutrient values? Other items in those meals are not changed.`}
            onConfirm={() => resnapshotMutation.mutate()}
            isPending={resnapshotMutation.isPending}
            buttonClass="btn-secondary"
          />
          <button
            type="button"
            class="btn-secondary"
            onClick={() => duplicateMutation.mutate()}
            disabled={duplicateMutation.isPending}
            title={
              isShared
                ? `Create an editable personal copy of ${item.name}`
                : `Create a copy of ${item.name} to edit`
            }
          >
            {duplicateMutation.isPending ? 'Duplicating…' : 'Duplicate'}
          </button>
          {!isShared && (
            <ConfirmButton
              label="Delete"
              confirmMessage={`Delete ${item.name}?`}
              onConfirm={() => deleteMutation.mutate()}
              isPending={deleteMutation.isPending}
            />
          )}
        </div>
      </div>

      {resnapshotResult && (
        <div class="fi-resnapshot-banner" role="status">
          Refreshed {resnapshotResult.rows_updated} row
          {resnapshotResult.rows_updated === 1 ? '' : 's'} across {resnapshotResult.meals_updated} meal
          {resnapshotResult.meals_updated === 1 ? '' : 's'}.
          <button type="button" class="btn-link" onClick={() => setResnapshotResult(null)}>
            Dismiss
          </button>
        </div>
      )}

      {isShared && (
        <p class="fi-shared-banner" role="note">
          Shared library item — only the icon can be customized for your account. Other fields are read-only.
        </p>
      )}

      <NameHeading item={item} isShared={isShared} name={name} setName={setName} commitName={commitName} />

      <div class="fi-icon-row">
        <label class="fi-icon-label">Icon</label>
        <IconInput value={icon} onChange={setIcon} onBlur={commitIcon} />
      </div>

      <DefaultMetaRow
        item={item}
        isShared={isShared}
        defaultQuantity={defaultQuantity}
        defaultUnit={defaultUnit}
        setDefaultQuantity={setDefaultQuantity}
        setDefaultUnit={setDefaultUnit}
        commitDefaultQuantity={commitDefaultQuantity}
        commitDefaultUnit={commitDefaultUnit}
      />

      {/* TODO: portions section for shared/central items goes through the
          override layer (shared_food_item_overrides.default_portion_id +
          a future per-user portions-on-central pattern). Deferred. */}
      {!isShared && <PortionsSection item={item} foodItemId={id} />}

      <CompositeOrAtomicSection
        item={item}
        isShared={isShared}
        ingredientsMutation={ingredientsMutation}
        clearMutation={clearMutation}
        referenceMutation={referenceMutation}
        save={save}
      />
    </div>
  )
}

function NameHeading({
  item,
  isShared,
  name,
  setName,
  commitName,
}: {
  item: ApiFoodItemDetail
  isShared: boolean
  name: string
  setName: (v: string) => void
  commitName: () => void
}) {
  return (
    <h1 class="fi-name-heading">
      {item.icon && isEmoji(item.icon) && <span class="fi-icon-display">{item.icon}</span>}
      {item.icon && (isUrl(item.icon) || isIconPath(item.icon)) && (
        <img src={item.icon} alt="" width={24} height={24} class="fi-icon-display-img" />
      )}
      {isShared ? (
        <span class="fi-name-readonly">{item.name}</span>
      ) : (
        <input
          type="text"
          class="fi-name-input"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          onBlur={commitName}
        />
      )}
    </h1>
  )
}

function DefaultMetaRow({
  item,
  isShared,
  defaultQuantity,
  defaultUnit,
  setDefaultQuantity,
  setDefaultUnit,
  commitDefaultQuantity,
  commitDefaultUnit,
}: {
  item: ApiFoodItemDetail
  isShared: boolean
  defaultQuantity: string
  defaultUnit: string
  setDefaultQuantity: (v: string) => void
  setDefaultUnit: (v: string) => void
  commitDefaultQuantity: () => void
  commitDefaultUnit: () => void
}) {
  return (
    <div class="fi-meta">
      {item.source && <span class="fi-source">Source: {item.source}</span>}
      <span class="fi-default-edit">
        Base:
        {isShared ? (
          <span class="fi-default-readonly">
            {item.default_quantity ?? '—'} {item.default_unit ?? ''}
          </span>
        ) : (
          <>
            <input
              type="number"
              step="0.1"
              value={defaultQuantity}
              placeholder="100"
              onInput={(e) => setDefaultQuantity((e.target as HTMLInputElement).value)}
              onBlur={commitDefaultQuantity}
            />
            <input
              type="text"
              value={defaultUnit}
              placeholder="g"
              onInput={(e) => setDefaultUnit((e.target as HTMLInputElement).value)}
              onBlur={commitDefaultUnit}
            />
          </>
        )}
      </span>
    </div>
  )
}

// Default logging amount — number + unit dropdown, same shape as the meal
// logger's row. The dropdown lists the base unit (value "") plus every named
// unit; picking one sets default_portion_id, the number sets
// default_log_quantity. Changing the unit keeps the current amount untouched
// (the user may have typed/altered it first) — only the unit changes.
function DefaultLoggingAmount({
  portions,
  baseUnit,
  effectiveDefault,
  effectiveQty,
  onCommit,
}: {
  portions: FoodItemPortion[]
  baseUnit: string
  effectiveDefault: string | undefined
  effectiveQty: number | undefined
  onCommit: (portionId: string | null, quantity: number | null) => void
}) {
  const [qty, setQty] = useState(effectiveQty !== undefined ? String(effectiveQty) : '')
  useEffect(() => {
    setQty(effectiveQty !== undefined ? String(effectiveQty) : '')
  }, [effectiveQty])

  const commitQty = () => {
    const t = qty.trim()
    if (t === '') {
      if (effectiveQty !== undefined) onCommit(effectiveDefault ?? null, null)
      return
    }
    const n = parseFloat(t)
    if (!(n > 0)) {
      setQty(effectiveQty !== undefined ? String(effectiveQty) : '')
      return
    }
    if (n !== effectiveQty) onCommit(effectiveDefault ?? null, n)
  }

  return (
    <div class="fi-default-amount">
      <label>Default:</label>
      <input
        type="number"
        step="0.1"
        class="fi-default-qty"
        value={qty}
        placeholder="Qty"
        onInput={(e) => setQty((e.target as HTMLInputElement).value)}
        onBlur={commitQty}
      />
      <select
        class="fi-default-unit"
        value={effectiveDefault ?? ''}
        onChange={(e) => {
          // Keep the current amount — only the unit changes. Empty = an
          // intentional clear (null → base quantity). A transient/invalid
          // value (e.g. mid-edit "abc" or a negative) must NOT wipe a saved
          // amount, so fall back to the last effective quantity rather than
          // committing null.
          const t = qty.trim()
          let quantity: number | null
          if (t === '') {
            quantity = null
          } else {
            const n = parseFloat(t)
            quantity = n > 0 ? n : (effectiveQty ?? null)
          }
          onCommit((e.target as HTMLSelectElement).value || null, quantity)
        }}
      >
        <option value="">{baseUnit}</option>
        {portions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label_unit}
          </option>
        ))}
      </select>
      <span class="fi-default-amount-hint">prefilled when logging</span>
    </div>
  )
}

function PortionsSection({ item, foodItemId }: { item: ApiFoodItemDetail; foodItemId: string }) {
  const queryClient = useQueryClient()
  const portions = item.portions ?? []
  const baseUnit = item.default_unit ?? 'base unit'
  const baseQty = item.default_quantity
  const [draft, setDraft] = useState({ label_unit: '', base_equivalent: '' })
  // Keep the add-row error separate from row-level (update/delete/default)
  // errors so an unrelated failure doesn't clear the message a user needs
  // to see while they fix their draft inputs.
  const [addError, setAddError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['foodItem', foodItemId] })

  const addMutation = useMutation({
    mutationFn: () => {
      const be = parseFloat(draft.base_equivalent)
      if (!draft.label_unit.trim() || !(be > 0)) {
        throw new Error('Unit and base-equivalent are required, and base-equivalent must be positive')
      }
      return addFoodItemPortionApi(foodItemId, {
        label_unit: draft.label_unit.trim(),
        base_equivalent: be,
      })
    },
    onError: (err: Error) => setAddError(err.message),
    onSuccess: () => {
      setDraft({ label_unit: '', base_equivalent: '' })
      setAddError(null)
      invalidate()
    },
  })

  const updateMutation = useMutation({
    mutationFn: (input: { portionId: string; body: Partial<FoodItemPortion> }) =>
      updateFoodItemPortionApi(foodItemId, input.portionId, {
        label_unit: input.body.label_unit,
        base_equivalent: input.body.base_equivalent,
      }),
    onError: (err: Error) => setRowError(err.message),
    onSuccess: () => {
      setRowError(null)
      invalidate()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (portionId: string) => deleteFoodItemPortionApi(foodItemId, portionId),
    onError: (err: Error) => setRowError(err.message),
    onSuccess: () => {
      setRowError(null)
      invalidate()
    },
  })

  // Default logging amount: which unit (portion id, or null = base) and how
  // much (quantity). The quantity carries across unit switches.
  const defaultMutation = useMutation({
    mutationFn: (input: { portionId: string | null; quantity: number | null }) =>
      setDefaultPortionApi(foodItemId, input.portionId, input.quantity),
    onError: (err: Error) => setRowError(err.message),
    onSuccess: () => {
      setRowError(null)
      invalidate()
    },
  })

  // Effective default is exposed by the server (resolves override layer for
  // central items); for per-user items it mirrors the row column.
  const effectiveDefault = item.effective_default_portion_id
  const effectiveQty = item.effective_default_quantity

  return (
    <section class="fi-portions">
      <header class="fi-portions-header">
        <h2>Units</h2>
        <p class="fi-portions-help">
          Extra units this food can be logged in. Each is "1 unit = amount in {baseUnit}"
          {baseQty !== undefined ? ` (nutrient values are per ${baseQty} ${baseUnit})` : ''}. Pick the default
          unit and amount to prefill when logging.
        </p>
      </header>

      <DefaultLoggingAmount
        portions={portions}
        baseUnit={baseUnit}
        effectiveDefault={effectiveDefault}
        effectiveQty={effectiveQty}
        onCommit={(portionId, quantity) => defaultMutation.mutate({ portionId, quantity })}
      />

      {portions.length > 0 && (
        <ul class="fi-portions-list">
          {portions.map((p) => (
            <PortionRow
              key={p.id}
              portion={p}
              baseUnit={baseUnit}
              onUpdate={(body) => updateMutation.mutate({ portionId: p.id, body })}
              onDelete={() => deleteMutation.mutate(p.id)}
            />
          ))}
        </ul>
      )}

      <div class="fi-portion-add">
        <span class="fi-portion-add-prefix">1</span>
        <input
          type="text"
          placeholder="Unit (e.g. ruta)"
          value={draft.label_unit}
          onInput={(e) => setDraft({ ...draft, label_unit: (e.target as HTMLInputElement).value })}
        />
        <span class="fi-portion-eq-sep">=</span>
        <input
          type="number"
          step="0.01"
          placeholder={`Amount in ${baseUnit}`}
          value={draft.base_equivalent}
          onInput={(e) => setDraft({ ...draft, base_equivalent: (e.target as HTMLInputElement).value })}
        />
        <span class="fi-portion-base-unit">{baseUnit}</span>
        <button
          type="button"
          class="btn-secondary"
          onClick={() => addMutation.mutate()}
          disabled={addMutation.isPending}
        >
          Add unit
        </button>
      </div>
      {addError && <p class="fi-portions-error">{addError}</p>}
      {rowError && <p class="fi-portions-error">{rowError}</p>}
    </section>
  )
}

function PortionRow({
  portion,
  baseUnit,
  onUpdate,
  onDelete,
}: {
  portion: FoodItemPortion
  baseUnit: string
  onUpdate: (body: Partial<FoodItemPortion>) => void
  onDelete: () => void
}) {
  // Auto-save on blur — mirrors the rest of FoodItemDetail's commit pattern.
  // Local state lets the user edit without each keystroke racing to the API.
  const [lu, setLu] = useState(portion.label_unit)
  const [be, setBe] = useState(String(portion.base_equivalent))

  // Independent effects so a mutation/invalidate that refreshes the
  // server-side value of one field doesn't clobber unsaved input on a
  // sibling field (the previous combined effect dropped pending edits any
  // time the user blurred a different field on the same row).
  useEffect(() => {
    setLu(portion.label_unit)
  }, [portion.id, portion.label_unit])
  useEffect(() => {
    setBe(String(portion.base_equivalent))
  }, [portion.id, portion.base_equivalent])

  const commitUnit = () => {
    const trimmed = lu.trim()
    if (!trimmed) {
      setLu(portion.label_unit)
      return
    }
    if (trimmed !== portion.label_unit) onUpdate({ label_unit: trimmed })
  }
  const commitBase = () => {
    const parsed = parseFloat(be)
    if (!(parsed > 0)) {
      // Revert; the schema rejects non-positive values.
      setBe(String(portion.base_equivalent))
      return
    }
    if (parsed !== portion.base_equivalent) onUpdate({ base_equivalent: parsed })
  }

  return (
    <li class="fi-portion-row">
      <span class="fi-portion-add-prefix">1</span>
      <input
        type="text"
        value={lu}
        onInput={(e) => setLu((e.target as HTMLInputElement).value)}
        onBlur={commitUnit}
      />
      <span class="fi-portion-eq-sep">=</span>
      <input
        type="number"
        step="0.01"
        value={be}
        onInput={(e) => setBe((e.target as HTMLInputElement).value)}
        onBlur={commitBase}
      />
      <span class="fi-portion-base-unit">{baseUnit}</span>
      <ConfirmButton
        label="Delete"
        confirmMessage={`Delete unit "${portion.label_unit}"?`}
        onConfirm={onDelete}
        buttonClass="btn-link fi-portion-del"
      />
    </li>
  )
}

interface CompositeProps {
  item: ApiFoodItemDetail
  isShared: boolean
  ingredientsMutation: { mutate: (ingredients: FoodItemIngredient[]) => void; isPending: boolean }
  clearMutation: { mutate: () => void; isPending: boolean }
  referenceMutation: { mutate: (referenceId: string | null) => void; isPending: boolean }
  save: (body: Record<string, unknown>) => void
}

function CompositeOrAtomicSection({
  item,
  isShared,
  ingredientsMutation,
  clearMutation,
  referenceMutation,
  save,
}: CompositeProps) {
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

  const enrichedFields = item.reference_enriched?.fields ?? {}

  return (
    <>
      {!isShared && (
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

          <ReferencePicker item={item} referenceMutation={referenceMutation} />
        </>
      )}

      <div class="nutrient-sections">
        {CATEGORIES.map(({ key, label }) => {
          const fields = NUTRIENT_FIELDS.filter((f) => f.category === key)
          if (fields.length === 0) return null
          // For shared rows, only show categories that have at least one
          // populated value — central LSV entries have most fields blank,
          // and rendering empty grids is just noise.
          if (isShared) {
            const populated = fields.filter(
              (f) => typeof item[f.name as keyof ApiFoodItemDetail] === 'number',
            )
            if (populated.length === 0) return null
            return (
              <div key={key} class="nutrient-section">
                <h3>{label}</h3>
                <div class="nutrient-grid">
                  {populated.map((f) => (
                    <div key={f.name} class="nutrient-row">
                      <span class="nutrient-label">{f.label}</span>
                      <span class="nutrient-value">
                        {(item[f.name as keyof ApiFoodItemDetail] as number).toFixed(2)} {f.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          }
          return (
            <div key={key} class="nutrient-section">
              <h3>{label}</h3>
              <div class="nutrient-grid">
                {fields.map((f) => {
                  const value = item[f.name as keyof ApiFoodItemDetail]
                  const selfValue = typeof value === 'number' ? value : undefined
                  const enriched = enrichedFields[f.name]
                  const inheritedValue =
                    selfValue === undefined &&
                    enriched?.origin === 'reference' &&
                    typeof enriched.value === 'number'
                      ? enriched.value
                      : undefined
                  return (
                    <div key={f.name} class="nutrient-row">
                      <span class="nutrient-label">{f.label}</span>
                      <NutrientInput
                        field={f}
                        initial={selfValue}
                        inheritedValue={inheritedValue}
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

function ReferencePicker({
  item,
  referenceMutation,
}: {
  item: ApiFoodItemDetail
  referenceMutation: { mutate: (referenceId: string | null) => void; isPending: boolean }
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const ref = item.reference?.food
  const unitMismatch = item.reference?.unit_mismatch ?? false

  return (
    <div class="fi-reference-row">
      <label class="fi-reference-label">Reference food</label>
      {ref && !pickerOpen && (
        <span class="fi-reference-current">
          <a href={`/food-items/${ref.id}`} class="fi-reference-name">
            {ref.icon && isEmoji(ref.icon) && <span class="fi-icon-display-inline">{ref.icon}</span>}
            {ref.name}
          </a>
          <button
            type="button"
            class="btn-link"
            onClick={() => {
              setDraftName(ref.name)
              setPickerOpen(true)
            }}
            disabled={referenceMutation.isPending}
          >
            Change
          </button>
          <button
            type="button"
            class="btn-link btn-link-danger"
            onClick={() => referenceMutation.mutate(null)}
            disabled={referenceMutation.isPending}
          >
            Clear
          </button>
        </span>
      )}
      {(!ref || pickerOpen) && (
        <span class="fi-reference-picker">
          <FoodItemAutocomplete
            value={draftName}
            onChange={setDraftName}
            onSelect={(picked) => {
              if (picked.id === item.id) return
              referenceMutation.mutate(picked.id)
              setPickerOpen(false)
              setDraftName('')
            }}
            placeholder="Search for a reference food…"
          />
          {pickerOpen && (
            <button
              type="button"
              class="btn-link"
              onClick={() => {
                setPickerOpen(false)
                setDraftName('')
              }}
            >
              Cancel
            </button>
          )}
        </span>
      )}
      {ref && unitMismatch && (
        <p class="fi-reference-warning">
          ⚠ Unit mismatch — this item's default unit ({item.default_unit ?? '?'}) can't be converted to the
          reference's ({ref.default_unit ?? '?'}). Inherited values are shown unscaled.
        </p>
      )}
    </div>
  )
}
