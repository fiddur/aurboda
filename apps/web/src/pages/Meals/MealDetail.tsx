import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation, useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import { ConfirmButton } from '../../components/ConfirmButton'
import { FoodItemAutocomplete } from '../../components/FoodItemAutocomplete'
import {
  deleteMealApi,
  fetchMeal,
  fetchUserSettings,
  type FoodItemEntity,
  updateMealApi,
} from '../../state/api'
import './MealDetail.css'

// ── Sub-components ───────────────────────────────────────────────────────────

interface FoodItemEdit {
  name: string
  quantity?: number
  unit?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
}

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'drink']

function MealTypeEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isCustom = !MEAL_TYPES.includes(value)
  return (
    <div class="type-editor">
      <select
        value={isCustom ? '__custom' : value}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value
          if (v !== '__custom') onChange(v)
        }}
      >
        {MEAL_TYPES.map((t) => (
          <option key={t} value={t}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </option>
        ))}
        <option value="__custom">Other...</option>
      </select>
      {isCustom && (
        <input
          type="text"
          value={value}
          placeholder="Custom type"
          onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        />
      )}
    </div>
  )
}

function MacrosEditor({
  calories,
  protein,
  carbs,
  fat,
  fiber,
  onChange,
}: {
  calories?: number | null
  protein?: number | null
  carbs?: number | null
  fat?: number | null
  fiber?: number | null
  onChange: (field: string, value: number | null) => void
}) {
  const parseNum = (v: string) => (v === '' ? null : parseFloat(v))
  return (
    <div class="macros-grid">
      {(['calories', 'protein', 'carbs', 'fat', 'fiber'] as const).map((field) => {
        const val = { calories, protein, carbs, fat, fiber }[field]
        return (
          <label key={field} class="macro-input">
            <span>{field === 'calories' ? 'kcal' : `${field} (g)`}</span>
            <input
              type="number"
              step="0.1"
              value={val ?? ''}
              onInput={(e) => onChange(field, parseNum((e.target as HTMLInputElement).value))}
            />
          </label>
        )
      })}
    </div>
  )
}

function MealFlagsEditor({
  selected,
  areas,
  onChange,
}: {
  selected: string[]
  areas: string[]
  onChange: (flags: string[]) => void
}) {
  if (areas.length === 0) return null
  return (
    <div class="flags-editor">
      {areas.map((area) => (
        <label key={area} class="flag-check">
          <input
            type="checkbox"
            checked={selected.includes(area)}
            onChange={() => {
              const next = selected.includes(area) ? selected.filter((s) => s !== area) : [...selected, area]
              onChange(next)
            }}
          />
          {area}
        </label>
      ))}
    </div>
  )
}

function FoodItemRow({
  item,
  index,
  onChange,
  onRemove,
}: {
  item: FoodItemEdit
  index: number
  onChange: (index: number, item: FoodItemEdit) => void
  onRemove: (index: number) => void
}) {
  const update = (field: string, value: unknown) => onChange(index, { ...item, [field]: value })
  const parseNum = (v: string) => (v === '' ? undefined : parseFloat(v))
  return (
    <div class="food-item-edit-row">
      <div class="food-row-top">
        <FoodItemAutocomplete
          value={item.name}
          onChange={(name) => update('name', name)}
          onSelect={(fi: FoodItemEntity) => {
            onChange(index, {
              ...item,
              name: fi.name,
              quantity: fi.default_quantity ?? item.quantity,
              unit: fi.default_unit ?? item.unit,
              calories: fi.calories ?? item.calories,
              protein: fi.protein ?? item.protein,
              carbs: fi.carbs ?? item.carbs,
              fat: fi.fat ?? item.fat,
              fiber: fi.fiber ?? item.fiber,
            })
          }}
        />
        <input
          type="number"
          step="0.1"
          value={item.quantity ?? ''}
          placeholder="Qty"
          class="food-num-input"
          onInput={(e) => update('quantity', parseNum((e.target as HTMLInputElement).value))}
        />
        <input
          type="text"
          value={item.unit ?? ''}
          placeholder="Unit"
          class="food-unit-input"
          onInput={(e) => update('unit', (e.target as HTMLInputElement).value)}
        />
        <button type="button" class="btn-danger-small" onClick={() => onRemove(index)}>
          &times;
        </button>
      </div>
      <div class="food-row-macros">
        <label>
          <span>kcal</span>
          <input
            type="number"
            step="0.1"
            value={item.calories ?? ''}
            onInput={(e) => update('calories', parseNum((e.target as HTMLInputElement).value))}
          />
        </label>
        <label>
          <span>prot</span>
          <input
            type="number"
            step="0.1"
            value={item.protein ?? ''}
            onInput={(e) => update('protein', parseNum((e.target as HTMLInputElement).value))}
          />
        </label>
        <label>
          <span>carbs</span>
          <input
            type="number"
            step="0.1"
            value={item.carbs ?? ''}
            onInput={(e) => update('carbs', parseNum((e.target as HTMLInputElement).value))}
          />
        </label>
        <label>
          <span>fat</span>
          <input
            type="number"
            step="0.1"
            value={item.fat ?? ''}
            onInput={(e) => update('fat', parseNum((e.target as HTMLInputElement).value))}
          />
        </label>
        <label>
          <span>fiber</span>
          <input
            type="number"
            step="0.1"
            value={item.fiber ?? ''}
            onInput={(e) => update('fiber', parseNum((e.target as HTMLInputElement).value))}
          />
        </label>
      </div>
    </div>
  )
}

function FoodItemsEditor({
  items,
  onChange,
}: {
  items: FoodItemEdit[]
  onChange: (items: FoodItemEdit[]) => void
}) {
  const handleChange = (index: number, item: FoodItemEdit) => {
    const next = [...items]
    next[index] = item
    onChange(next)
  }
  const handleRemove = (index: number) => onChange(items.filter((_, i) => i !== index))
  const handleAdd = () => onChange([...items, { name: '' }])

  return (
    <div class="food-items-editor">
      {items.map((item, i) => (
        <FoodItemRow key={i} item={item} index={i} onChange={handleChange} onRemove={handleRemove} />
      ))}
      <button type="button" class="btn-secondary btn-add-item" onClick={handleAdd}>
        + Add food item
      </button>
    </div>
  )
}

// ── Read-only info rows ──────────────────────────────────────────────────────

// ── Edit state ───────────────────────────────────────────────────────────────

interface EditState {
  name?: string
  time?: string
  notes?: string
  meal_type?: string
  calories?: number | null
  protein?: number | null
  carbs?: number | null
  fat?: number | null
  fiber?: number | null
  food_items?: FoodItemEdit[]
  sensitivities?: string[]
}

/** Build the PATCH body from edit state, auto-summing macros from food items. */
const buildSaveBody = (editing: EditState): Record<string, unknown> => {
  const body: Record<string, unknown> = {}
  if (editing.name !== undefined) body.name = editing.name || null
  if (editing.time !== undefined) body.time = new Date(editing.time).toISOString()
  if (editing.notes !== undefined) body.notes = editing.notes || null
  if (editing.meal_type !== undefined) body.meal_type = editing.meal_type
  if (editing.sensitivities !== undefined) body.sensitivities = editing.sensitivities

  const items = editing.food_items?.filter((fi) => fi.name.trim())
  if (items !== undefined) {
    body.food_items = items
    // Auto-sum macros from food items
    const sumField = (field: keyof FoodItemEdit) => {
      const total = items.reduce((s, fi) => s + ((fi[field] as number) ?? 0), 0)
      return total > 0 ? Math.round(total * 100) / 100 : null
    }
    body.calories = sumField('calories')
    body.protein = sumField('protein')
    body.carbs = sumField('carbs')
    body.fat = sumField('fat')
    body.fiber = sumField('fiber')
  } else {
    if (editing.calories !== undefined) body.calories = editing.calories
    if (editing.protein !== undefined) body.protein = editing.protein
    if (editing.carbs !== undefined) body.carbs = editing.carbs
    if (editing.fat !== undefined) body.fat = editing.fat
    if (editing.fiber !== undefined) body.fiber = editing.fiber
  }

  return body
}

// ── Main component ───────────────────────────────────────────────────────────

// eslint-disable-next-line complexity -- detail page with edit mode and multiple data sections
export function MealDetail() {
  const { params } = useRoute()
  const { route } = useLocation()
  const queryClient = useQueryClient()
  const id = params.id

  const { data: meal, isLoading } = useQuery({
    queryFn: () => fetchMeal(id),
    queryKey: ['meal', id],
  })

  const { data: settings } = useQuery({
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const [editing, setEditing] = useState<EditState | null>(null)

  const updateMutation = useMutation({
    mutationFn: (body: Parameters<typeof updateMealApi>[1]) => updateMealApi(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meal', id] })
      queryClient.invalidateQueries({ queryKey: ['meals'] })
      setEditing(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteMealApi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meals'] })
      route('/meals')
    },
  })

  if (isLoading) {
    return (
      <div class="meal-detail-page">
        <p class="loading">Loading...</p>
      </div>
    )
  }
  if (!meal) {
    return (
      <div class="meal-detail-page">
        <p>Meal not found.</p>
      </div>
    )
  }

  const isEditing = editing !== null
  const flagAreas: string[] = settings?.sensitivity_areas ?? []

  // Edit values with fallback to meal
  const editName = editing?.name ?? meal.name ?? ''
  const editTime = editing?.time ?? format(meal.time, "yyyy-MM-dd'T'HH:mm")
  const editNotes = editing?.notes ?? meal.notes ?? ''
  const editType = editing?.meal_type ?? meal.meal_type ?? 'lunch'
  const editCal = editing?.calories !== undefined ? editing.calories : meal.calories
  const editProt = editing?.protein !== undefined ? editing.protein : meal.protein
  const editCarbs = editing?.carbs !== undefined ? editing.carbs : meal.carbs
  const editFat = editing?.fat !== undefined ? editing.fat : meal.fat
  const editFiber = editing?.fiber !== undefined ? editing.fiber : meal.fiber
  const editItems =
    editing?.food_items ??
    (meal.food_items ?? []).map((fi) => ({
      name: fi.name,
      quantity: fi.quantity,
      unit: fi.unit,
      calories: fi.calories,
      protein: fi.protein,
      carbs: fi.carbs,
      fat: fi.fat,
      fiber: fi.fiber,
    }))
  const editFlags = editing?.sensitivities ?? meal.sensitivities ?? []

  const startEditing = () => setEditing({})

  const handleSave = () => {
    if (!editing) return
    const body = buildSaveBody(editing)
    updateMutation.mutate(body)
  }

  const macroDisplay = [
    meal.calories !== undefined && `${meal.calories} kcal`,
    meal.protein !== undefined && `${meal.protein}g protein`,
    meal.carbs !== undefined && `${meal.carbs}g carbs`,
    meal.fat !== undefined && `${meal.fat}g fat`,
    meal.fiber !== undefined && `${meal.fiber}g fiber`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div class="meal-detail-page">
      <div class="detail-header">
        <a href={`/meals?date=${format(meal.time, 'yyyy-MM-dd')}`} class="back-link">
          &larr; Back
        </a>
        <div class="detail-actions">
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
            <button type="button" class="btn-secondary" onClick={startEditing}>
              Edit
            </button>
          )}
          <ConfirmButton
            label="Delete"
            confirmMessage="Delete this meal?"
            onConfirm={() => deleteMutation.mutate()}
            isPending={deleteMutation.isPending}
          />
        </div>
      </div>

      <div class="detail-card">
        {/* Type */}
        <div class="detail-row">
          <label>Type</label>
          {isEditing ? (
            <MealTypeEditor value={editType} onChange={(v) => setEditing({ ...editing, meal_type: v })} />
          ) : (
            <span class="detail-value">{meal.meal_type ?? '—'}</span>
          )}
        </div>

        {/* Time */}
        <div class="detail-row">
          <label>Time</label>
          {isEditing ? (
            <input
              type="datetime-local"
              value={editTime}
              onInput={(e) => setEditing({ ...editing, time: (e.target as HTMLInputElement).value })}
            />
          ) : (
            <span class="detail-value">{format(meal.time, 'yyyy-MM-dd HH:mm')}</span>
          )}
        </div>

        {/* Name */}
        <div class="detail-row">
          <label>Name</label>
          {isEditing ? (
            <input
              type="text"
              value={editName}
              placeholder="Meal name"
              onInput={(e) => setEditing({ ...editing, name: (e.target as HTMLInputElement).value })}
            />
          ) : (
            <span class="detail-value">{meal.name || '—'}</span>
          )}
        </div>

        {/* Macros */}
        <div class="detail-row">
          <label>Macros</label>
          {isEditing ? (
            <MacrosEditor
              calories={editCal}
              protein={editProt}
              carbs={editCarbs}
              fat={editFat}
              fiber={editFiber}
              onChange={(field, val) => setEditing({ ...editing, [field]: val })}
            />
          ) : (
            <span class="detail-value">{macroDisplay || '—'}</span>
          )}
        </div>

        {/* Flags */}
        <div class="detail-row">
          <label>Flags</label>
          {isEditing ? (
            <MealFlagsEditor
              selected={editFlags}
              areas={flagAreas}
              onChange={(flags) => setEditing({ ...editing, sensitivities: flags })}
            />
          ) : meal.sensitivities && meal.sensitivities.length > 0 ? (
            <div class="detail-sensitivities">
              {meal.sensitivities.map((s) => (
                <span key={s} class="detail-sensitivity-chip">
                  {s}
                </span>
              ))}
            </div>
          ) : (
            <span class="detail-value">—</span>
          )}
        </div>

        {/* Food Items */}
        <div class="detail-row detail-row-block">
          <label>Food Items</label>
          {isEditing ? (
            <FoodItemsEditor
              items={editItems}
              onChange={(items) => setEditing({ ...editing, food_items: items })}
            />
          ) : meal.food_items && meal.food_items.length > 0 ? (
            <div class="detail-food-items">
              {meal.food_items.map((item, i) => (
                <span key={i} class="detail-food-chip">
                  {item.name}
                  {item.quantity ? ` (${item.quantity}${item.unit ? ' ' + item.unit : ''})` : ''}
                </span>
              ))}
            </div>
          ) : (
            <span class="detail-value">—</span>
          )}
        </div>

        {/* Notes */}
        <div class="detail-row">
          <label>Notes</label>
          {isEditing ? (
            <textarea
              value={editNotes}
              placeholder="Notes..."
              rows={3}
              onInput={(e) => setEditing({ ...editing, notes: (e.target as HTMLTextAreaElement).value })}
            />
          ) : (
            <span class="detail-value">{meal.notes || '—'}</span>
          )}
        </div>

        {!isEditing && (
          <div class="detail-row">
            <label>Source</label>
            <span class="detail-value">{meal.source ?? '—'}</span>
          </div>
        )}
      </div>
    </div>
  )
}
