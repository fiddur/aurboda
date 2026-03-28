import { NUTRIENT_FIELDS, type NutrientFieldDef } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import type { FoodItemEntity } from '../../state/api'

import { ConfirmButton } from '../../components/ConfirmButton'
import { auth } from '../../state/auth'
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

function NutrientSection({
  item,
  category,
  label,
  editing,
  onEdit,
}: {
  item: FoodItemEntity
  category: string
  label: string
  editing: Record<string, unknown> | null
  onEdit?: (field: string, value: number | undefined) => void
}) {
  const fields = NUTRIENT_FIELDS.filter((f) => f.category === category)
  const isEditing = editing !== null
  const populated = isEditing
    ? fields
    : fields.filter((f) => item[f.name] !== undefined && item[f.name] !== null)
  if (populated.length === 0) return null

  return (
    <div class="nutrient-section">
      <h3>{label}</h3>
      <div class="nutrient-grid">
        {populated.map((f) => {
          const val = editing?.[f.name] !== undefined ? editing[f.name] : item[f.name]
          return (
            <div key={f.name} class="nutrient-row">
              <span class="nutrient-label">{f.label}</span>
              {isEditing ? (
                <span class="nutrient-edit">
                  <input
                    type="number"
                    step="0.01"
                    value={typeof val === 'number' ? val : ''}
                    onInput={(e) => {
                      const v = (e.target as HTMLInputElement).value
                      onEdit?.(f.name, v === '' ? undefined : parseFloat(v))
                    }}
                  />
                  <span class="nutrient-unit">{f.unit}</span>
                </span>
              ) : (
                <span class="nutrient-value">
                  {typeof val === 'number' ? val.toFixed(2) : val} {f.unit}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// eslint-disable-next-line complexity -- detail page with edit mode
export function FoodItemDetail() {
  const { params } = useRoute()
  const { route } = useLocation()
  const queryClient = useQueryClient()
  const id = params.id

  const { data: item, isLoading } = useQuery({
    queryFn: () => fetchFoodItem(id),
    queryKey: ['foodItem', id],
  })

  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateFoodItemApi(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodItem', id] })
      queryClient.invalidateQueries({ queryKey: ['foodItems'] })
      setEditing(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteFoodItemApi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodItems'] })
      route('/food-items')
    },
  })

  if (isLoading)
    {return (
      <div class="food-item-detail-page">
        <p class="loading">Loading...</p>
      </div>
    )}
  if (!item)
    {return (
      <div class="food-item-detail-page">
        <p>Food item not found.</p>
      </div>
    )}

  const isEditing = editing !== null
  const editName = (editing?.name as string) ?? item.name
  const editQty = (editing?.default_quantity as number) ?? item.default_quantity
  const editUnit = (editing?.default_unit as string) ?? item.default_unit

  const handleSave = () => {
    if (!editing) return
    updateMutation.mutate(editing)
  }

  return (
    <div class="food-item-detail-page">
      <div class="fi-detail-header">
        <a href="/food-items" class="back-link">
          &larr; Food Items
        </a>
        <div class="fi-detail-actions">
          {isEditing ? (
            <>
              <button
                type="button"
                class="btn-primary"
                onClick={handleSave}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </button>
              <button type="button" class="btn-secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" class="btn-secondary" onClick={() => setEditing({})}>
              Edit
            </button>
          )}
          <ConfirmButton
            label="Delete"
            confirmMessage={`Delete ${item.name}?`}
            onConfirm={() => deleteMutation.mutate()}
            isPending={deleteMutation.isPending}
          />
        </div>
      </div>

      {isEditing ? (
        <input
          type="text"
          class="fi-name-input"
          value={editName}
          onInput={(e) => setEditing({ ...editing, name: (e.target as HTMLInputElement).value })}
        />
      ) : (
        <h1>{item.name}</h1>
      )}

      <div class="fi-meta">
        {item.source && <span class="fi-source">Source: {item.source}</span>}
        {isEditing ? (
          <span class="fi-default-edit">
            Default:
            <input
              type="number"
              step="0.1"
              value={editQty ?? ''}
              placeholder="Qty"
              onInput={(e) =>
                setEditing({
                  ...editing,
                  default_quantity: parseFloat((e.target as HTMLInputElement).value) || undefined,
                })
              }
            />
            <input
              type="text"
              value={editUnit ?? ''}
              placeholder="Unit"
              onInput={(e) => setEditing({ ...editing, default_unit: (e.target as HTMLInputElement).value })}
            />
          </span>
        ) : item.default_quantity ? (
          <span class="fi-default">
            Default: {item.default_quantity} {item.default_unit ?? 'serving'}
          </span>
        ) : null}
      </div>

      <div class="nutrient-sections">
        {CATEGORIES.map(({ key, label }) => (
          <NutrientSection
            key={key}
            item={item}
            category={key}
            label={label}
            editing={editing}
            onEdit={(field, value) => setEditing({ ...editing, [field]: value })}
          />
        ))}
      </div>
    </div>
  )
}
