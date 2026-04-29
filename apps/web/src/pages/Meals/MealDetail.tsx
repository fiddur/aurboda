import type { UpdateMealBody } from '@aurboda/api-spec'

import { NUTRIENT_FIELDS } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation, useRoute } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import { ConfirmButton } from '../../components/ConfirmButton'
import { FoodItemAutocomplete } from '../../components/FoodItemAutocomplete'
import {
  deleteMealApi,
  fetchMeal,
  fetchUserSettings,
  type FoodItemEntity,
  updateMealApi,
} from '../../state/api'
import { LocationInfo, MEAL_LOCATION_WINDOW_MS } from '../EntityDetail/LocationInfo'
import './MealDetail.css'

// ── Sub-components ───────────────────────────────────────────────────────────

interface FoodItemRef {
  quantity?: number
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
}

interface FoodItemEdit {
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

/** Linearly scale a reference nutrient value to the current quantity. */
const scaleNutrient = (
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

type MacroField = 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber'
type MacroValues = Partial<Record<MacroField, number | null | undefined>>

function MacrosEditor({
  values,
  onChange,
  onCommit,
}: {
  values: MacroValues
  onChange: (field: MacroField, value: number | null) => void
  onCommit: (field: MacroField, value: number | null) => void
}) {
  const parseNum = (v: string) => (v === '' ? null : parseFloat(v))
  return (
    <div class="macros-grid">
      {(['calories', 'protein', 'carbs', 'fat', 'fiber'] as const).map((field) => (
        <label key={field} class="macro-input">
          <span>{field === 'calories' ? 'kcal' : `${field} (g)`}</span>
          <input
            type="number"
            step="0.1"
            value={values[field] ?? ''}
            onInput={(e) => onChange(field, parseNum((e.target as HTMLInputElement).value))}
            onBlur={(e) => onCommit(field, parseNum((e.target as HTMLInputElement).value))}
          />
        </label>
      ))}
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
  const update = (field: keyof FoodItemEdit, value: unknown) => onChange(index, { ...item, [field]: value })
  const parseNum = (v: string) => (v === '' ? undefined : parseFloat(v))

  const kcal = scaleNutrient(item.ref, 'calories', item.quantity)
  const prot = scaleNutrient(item.ref, 'protein', item.quantity)
  const carbs = scaleNutrient(item.ref, 'carbs', item.quantity)
  const fat = scaleNutrient(item.ref, 'fat', item.quantity)
  const fiber = scaleNutrient(item.ref, 'fiber', item.quantity)
  const hasMacros = [kcal, prot, carbs, fat, fiber].some((v) => typeof v === 'number')

  return (
    <div class="food-item-edit-row">
      <div class="food-row-top">
        <FoodItemAutocomplete
          value={item.name}
          onChange={(name) => update('name', name)}
          onSelect={(fi: FoodItemEntity) => {
            onChange(index, {
              ...item,
              food_item_id: fi.id,
              name: fi.name,
              quantity: fi.default_quantity ?? 1,
              unit: fi.default_unit ?? item.unit,
              ref: {
                calories: fi.calories,
                carbs: fi.carbs,
                fat: fi.fat,
                fiber: fi.fiber,
                protein: fi.protein,
                quantity: fi.default_quantity,
              },
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
      {hasMacros && (
        <div class="food-row-macros-display">
          {typeof kcal === 'number' && <span>{kcal} kcal</span>}
          {typeof prot === 'number' && <span>P {prot}g</span>}
          {typeof carbs === 'number' && <span>C {carbs}g</span>}
          {typeof fat === 'number' && <span>F {fat}g</span>}
          {typeof fiber === 'number' && <span>Fib {fiber}g</span>}
        </div>
      )}
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

// ── Nutrient breakdown ───────────────────────────────────────────────────────

const NUTRIENT_CATEGORIES = [
  { key: 'macro', label: 'Macros' },
  { key: 'extended_macro', label: 'Extended' },
  { key: 'fat_breakdown', label: 'Fats' },
  { key: 'vitamin', label: 'Vitamins' },
  { key: 'mineral', label: 'Minerals' },
  { key: 'amino_acid', label: 'Amino Acids' },
  { key: 'other', label: 'Other' },
] as const

function NutrientBreakdown({ nutrients }: { nutrients: Record<string, number> }) {
  const [collapsed, setCollapsed] = useState(true)

  return (
    <div class="nutrient-breakdown">
      {/* Toggle only visible on narrow screens (hidden via CSS on wide) */}
      <button type="button" class="nutrient-toggle" onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? '▸' : '▾'} Nutrients ({Object.keys(nutrients).length})
      </button>
      <div class={`nutrient-groups ${collapsed ? 'collapsed-mobile' : ''}`}>
        {NUTRIENT_CATEGORIES.map(({ key, label }) => {
          const fields = NUTRIENT_FIELDS.filter((f) => f.category === key && nutrients[f.name] !== undefined)
          if (fields.length === 0) return null
          return (
            <div key={key} class="nutrient-group">
              <h4>{label}</h4>
              {fields.map((f) => (
                <div key={f.name} class="nutrient-line">
                  <span>{f.label}</span>
                  <span>
                    {nutrients[f.name].toFixed(1)} {f.unit}
                  </span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Save indicator ───────────────────────────────────────────────────────────

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

// ── Main component ───────────────────────────────────────────────────────────

const FOOD_ITEM_DEBOUNCE_MS = 600

const mealItemsToEdit = (
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

const editItemsToBody = (items: FoodItemEdit[]): UpdateMealBody['food_items'] =>
  items
    .filter((fi) => fi.name.trim())
    .map((fi) => ({
      food_item_id: fi.food_item_id,
      name: fi.name,
      quantity: fi.quantity,
      unit: fi.unit,
    }))

// eslint-disable-next-line complexity -- detail page with many independently auto-saved fields
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

  // Local input state — synced from `meal` on load and after each save.
  const [name, setName] = useState('')
  const [timeStr, setTimeStr] = useState('')
  const [notes, setNotes] = useState('')
  const [mealType, setMealType] = useState('lunch')
  const [items, setItems] = useState<FoodItemEdit[]>([])
  const [flags, setFlags] = useState<string[]>([])
  const [macros, setMacros] = useState<MacroValues>({})

  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const itemsDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Invalidate the meals list when leaving this page so the day overview refreshes
  useEffect(() => () => void queryClient.invalidateQueries({ queryKey: ['meals'] }), [queryClient])

  // Clear pending timers on unmount so callbacks don't fire against an unmounted component.
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
      if (itemsDebounce.current) clearTimeout(itemsDebounce.current)
    },
    [],
  )

  // Re-seed local fields only when navigating to a different meal — depending
  // on `[meal]` would re-run on every post-save refetch and clobber any
  // in-progress autocomplete draft (e.g. typing a new food item name when
  // a debounced save round-trips). Same fix as on FoodItemDetail.
  useEffect(() => {
    if (!meal) return
    setName(meal.name ?? '')
    setTimeStr(format(meal.time, "yyyy-MM-dd'T'HH:mm"))
    setNotes(meal.notes ?? '')
    setMealType(meal.meal_type ?? 'lunch')
    setItems(mealItemsToEdit(meal.food_items))
    setFlags(meal.sensitivities ?? [])
    setMacros({
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fat: meal.fat,
      fiber: meal.fiber,
    })
  }, [meal?.id])

  const updateMutation = useMutation({
    mutationFn: (body: UpdateMealBody) => updateMealApi(id, body),
    onError: (err: Error) => setSaveError(err.message ?? 'Save failed'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meal', id] })
      queryClient.invalidateQueries({ queryKey: ['meals'] })
      setSaveError(null)
      setSavedFlash(true)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setSavedFlash(false), 1200)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteMealApi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meals'] })
      route('/meals')
    },
  })

  // Apply a partial update if the new value differs from the current server value.
  const save = (body: UpdateMealBody) => {
    setSaveError(null)
    updateMutation.mutate(body)
  }

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

  const flagAreas: string[] = settings?.sensitivity_areas ?? []

  const commitItems = (next: FoodItemEdit[]) => {
    setItems(next)
    if (itemsDebounce.current) clearTimeout(itemsDebounce.current)
    itemsDebounce.current = setTimeout(() => {
      save({ food_items: editItemsToBody(next) })
    }, FOOD_ITEM_DEBOUNCE_MS)
  }

  const commitName = () => {
    if ((name || null) !== (meal.name ?? null)) save({ name: name || null })
  }
  const commitTime = () => {
    const d = new Date(timeStr)
    if (Number.isNaN(d.getTime())) return // ignore invalid/empty datetime input
    const iso = d.toISOString()
    if (iso !== meal.time.toISOString()) save({ time: iso })
  }
  const commitNotes = () => {
    if ((notes || null) !== (meal.notes ?? null)) save({ notes: notes || null })
  }
  const commitMacro = (field: MacroField, value: number | null) => {
    const current = meal[field] ?? null
    if (value !== current) save({ [field]: value } as UpdateMealBody)
  }

  return (
    <div class="meal-detail-page">
      <div class="detail-header">
        <a href={`/meals?date=${format(meal.time, 'yyyy-MM-dd')}`} class="back-link">
          &larr; Back
        </a>
        <div class="detail-actions">
          <SaveIndicator isPending={updateMutation.isPending} showSaved={savedFlash} error={saveError} />
          <ConfirmButton
            label="Delete"
            confirmMessage="Delete this meal?"
            onConfirm={() => deleteMutation.mutate()}
            isPending={deleteMutation.isPending}
          />
        </div>
      </div>

      {meal.source && meal.source !== 'manual' && <p class="detail-source-caption">Source: {meal.source}</p>}

      <div class="detail-layout">
        <div class="detail-card">
          <div class="detail-row">
            <label>Type</label>
            <MealTypeEditor
              value={mealType}
              onChange={(v) => {
                setMealType(v)
                if (v !== (meal.meal_type ?? '')) save({ meal_type: v })
              }}
            />
          </div>

          <div class="detail-row">
            <label>Time</label>
            <input
              type="datetime-local"
              value={timeStr}
              onInput={(e) => setTimeStr((e.target as HTMLInputElement).value)}
              onBlur={commitTime}
            />
          </div>

          <div class="detail-row">
            <label>Name</label>
            <input
              type="text"
              value={name}
              placeholder="Meal name"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              onBlur={commitName}
            />
          </div>

          <div class="detail-row">
            <label>Flags</label>
            <MealFlagsEditor
              selected={flags}
              areas={flagAreas}
              onChange={(next) => {
                setFlags(next)
                save({ sensitivities: next })
              }}
            />
          </div>

          <LocationInfo start={meal.time} end={new Date(meal.time.getTime() + MEAL_LOCATION_WINDOW_MS)} />

          <div class="detail-row detail-row-block">
            <label>Food Items</label>
            <FoodItemsEditor items={items} onChange={commitItems} />
          </div>

          <div class="detail-row">
            <label>Macros</label>
            <MacrosEditor
              values={macros}
              onChange={(field, val) => setMacros((s) => ({ ...s, [field]: val }))}
              onCommit={commitMacro}
            />
          </div>

          <div class="detail-row">
            <label>Notes</label>
            <textarea
              value={notes}
              placeholder="Notes..."
              rows={3}
              onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
              onBlur={commitNotes}
            />
          </div>
        </div>

        {meal.nutrients && Object.keys(meal.nutrients).length > 0 ? (
          <div>
            <NutrientBreakdown nutrients={meal.nutrients} />
            {meal.nutrient_data_incomplete && (
              <p class="incomplete-notice">Some food items lack nutrient data — totals may be understated.</p>
            )}
          </div>
        ) : (
          <div class="nutrient-breakdown nutrient-placeholder" />
        )}
      </div>
    </div>
  )
}
