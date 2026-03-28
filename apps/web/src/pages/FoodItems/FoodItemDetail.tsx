import { NUTRIENT_FIELDS, type NutrientFieldDef } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'

import type { FoodItemEntity } from '../../state/api'
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
}: {
  item: FoodItemEntity
  category: string
  label: string
}) {
  const fields = NUTRIENT_FIELDS.filter((f) => f.category === category)
  const populated = fields.filter((f) => item[f.name] !== undefined && item[f.name] !== null)
  if (populated.length === 0) return null

  return (
    <div class="nutrient-section">
      <h3>{label}</h3>
      <div class="nutrient-grid">
        {populated.map((f) => (
          <div key={f.name} class="nutrient-row">
            <span class="nutrient-label">{f.label}</span>
            <span class="nutrient-value">
              {typeof item[f.name] === 'number' ? (item[f.name] as number).toFixed(2) : item[f.name]} {f.unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function FoodItemDetail() {
  const { params } = useRoute()
  const id = params.id

  const { data: item, isLoading } = useQuery({
    queryFn: () => fetchFoodItem(id),
    queryKey: ['foodItem', id],
  })

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

  return (
    <div class="food-item-detail-page">
      <a href="/food-items" class="back-link">
        &larr; Food Items
      </a>

      <h1>{item.name}</h1>

      <div class="fi-meta">
        {item.source && <span class="fi-source">Source: {item.source}</span>}
        {item.default_quantity && (
          <span class="fi-default">
            Default: {item.default_quantity} {item.default_unit ?? 'serving'}
          </span>
        )}
      </div>

      <div class="nutrient-sections">
        {CATEGORIES.map(({ key, label }) => (
          <NutrientSection key={key} item={item} category={key} label={label} />
        ))}
      </div>
    </div>
  )
}
