import { NUTRIENT_FIELDS, type NutrientFieldDef } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useRoute } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { FoodItemEntity } from '../../state/api'

import { ConfirmButton } from '../../components/ConfirmButton'
import { IconInput } from '../../components/IconInput'
import { auth } from '../../state/auth'
import { isEmoji, isIconPath, isUrl } from '../../utils/emojiLookup'
import './FoodItemDetail.css'

const API_URL = import.meta.env.VITE_API_URL || '/api'

const fetchFoodItem = async (id: string): Promise<FoodItemEntity> => {
  const { token } = auth.value
  const res = await fetch(`${API_URL}/food-items/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Food item not found')
  const json = await res.json()
  return json.data
}

const updateFoodItemApi = async (id: string, body: Record<string, unknown>): Promise<FoodItemEntity> => {
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

      <div class="nutrient-sections">
        {CATEGORIES.map(({ key, label }) => {
          const fields = NUTRIENT_FIELDS.filter((f) => f.category === key)
          if (fields.length === 0) return null
          return (
            <div key={key} class="nutrient-section">
              <h3>{label}</h3>
              <div class="nutrient-grid">
                {fields.map((f) => {
                  const value = item[f.name]
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
    </div>
  )
}
