import type { FoodItemDetail as ApiFoodItemDetail, FoodItemPortion, UpdateMealBody } from '@aurboda/api-spec'

import { NUTRIENT_FIELDS } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation, useRoute } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import { ConfirmButton } from '../../components/ConfirmButton'
import { FoodItemAutocomplete } from '../../components/FoodItemAutocomplete'
import {
  addFoodItemApi,
  deleteMealApi,
  fetchFoodItemDetailApi,
  fetchMeal,
  fetchSensitivityFlags,
  type FoodItemEntity,
  updateMealApi,
} from '../../state/api'
import { createDebouncedFlusher } from '../../utils/debouncedFlusher'
import { LocationInfo, MEAL_LOCATION_WINDOW_MS } from '../EntityDetail/LocationInfo'
import './MealDetail.css'
import { editItemsToBody, type FoodItemEdit, mealItemsToEdit, scaleNutrient } from './mealItems'
import { DEFAULT_CUSTOM_TYPE, MEAL_TYPES, resolveMealTypeChange } from './mealTypes'

// ── Sub-components ───────────────────────────────────────────────────────────

function MealTypeEditor({
  value,
  onChange,
  onCustomCommit,
}: {
  value: string
  onChange: (v: string) => void
  /**
   * Called on blur of the custom-type text input — gives the parent a
   * chance to debounce keystroke saves and only persist the final value.
   */
  onCustomCommit?: (v: string) => void
}) {
  const isCustom = !(MEAL_TYPES as readonly string[]).includes(value)
  return (
    <div class="type-editor">
      <select
        value={isCustom ? '__custom' : value}
        onChange={(e) => {
          const next = resolveMealTypeChange(value, (e.target as HTMLSelectElement).value)
          if (next !== null) onChange(next)
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
          onBlur={(e) => onCustomCommit?.((e.target as HTMLInputElement).value)}
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

const parseNum = (v: string) => (v === '' ? undefined : parseFloat(v))

/**
 * Once the food's detail arrives, do two things (each at most once per food
 * id):
 *
 *   1. If the row is already pinned to a portion (e.g. editing an existing
 *      meal that was logged with `food_item_portion_id`), backfill the
 *      `portion` snapshot from detail.portions — the meal response doesn't
 *      include label_quantity/label_unit/base_equivalent, so without this
 *      backfill the row would render via the legacy quantity+unit path even
 *      though saves still go through the portion path.
 *   2. Otherwise (fresh row, no portion yet) apply the food's effective
 *      default portion if one is set.
 */
const useAutoDefaultPortion = (
  item: FoodItemEdit,
  detail: ApiFoodItemDetail | undefined,
  applyPortion: (p: FoodItemPortion, keepCount: boolean) => void,
): void => {
  const lastAppliedFoodId = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!detail || !item.food_item_id) return
    if (lastAppliedFoodId.current === item.food_item_id) return
    lastAppliedFoodId.current = item.food_item_id
    if (item.food_item_portion_id) {
      // Already pinned. Backfill the snapshot if we're missing it (loading
      // an existing meal). If the portion id no longer resolves (deleted
      // since logging), leave the row alone — the user will see legacy
      // qty/unit and can re-pick.
      if (item.portion) return
      const p = detail.portions?.find((pp) => pp.id === item.food_item_portion_id)
      if (p) applyPortion(p, /* keepCount */ true)
      return
    }
    // Auto-default-portion only applies to rows added THIS session (`_isNew`).
    // Without this gate we'd silently re-encode legacy server-loaded rows
    // (e.g. "50 g chocolate") as `1 × default portion` on meal open,
    // overwriting the user's recorded quantity.
    if (!item._isNew) return
    const def = detail.effective_default_portion_id
    if (!def) return
    const p = detail.portions?.find((pp) => pp.id === def)
    if (p) applyPortion(p, /* keepCount */ false)
  }, [detail?.id, item.food_item_id])
}

function PortionPicker({
  selectedId,
  portions,
  baseLabel,
  onPick,
}: {
  selectedId: string | undefined
  portions: FoodItemPortion[]
  baseLabel: string
  onPick: (portionId: string) => void
}) {
  if (portions.length === 0) return null
  return (
    <select
      class="food-portion-picker"
      value={selectedId ?? ''}
      onChange={(e) => onPick((e.target as HTMLSelectElement).value)}
    >
      <option value="">Base ({baseLabel})</option>
      {portions.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label_quantity} {p.label_unit}
        </option>
      ))}
    </select>
  )
}

function QuantityInputs({
  item,
  onUpdate,
}: {
  item: FoodItemEdit
  onUpdate: (patch: Partial<FoodItemEdit>) => void
}) {
  if (item.food_item_portion_id && item.portion) {
    return (
      <>
        <input
          type="number"
          step="0.1"
          value={item.portion_count ?? ''}
          placeholder="Count"
          class="food-num-input"
          onInput={(e) => onUpdate({ portion_count: parseNum((e.target as HTMLInputElement).value) })}
        />
        <span class="food-portion-unit">
          × {item.portion.label_quantity} {item.portion.label_unit}
        </span>
      </>
    )
  }
  return (
    <>
      <input
        type="number"
        step="0.1"
        value={item.quantity ?? ''}
        placeholder="Qty"
        class="food-num-input"
        onInput={(e) => onUpdate({ quantity: parseNum((e.target as HTMLInputElement).value) })}
      />
      <input
        type="text"
        value={item.unit ?? ''}
        placeholder="Unit"
        class="food-unit-input"
        onInput={(e) => onUpdate({ unit: (e.target as HTMLInputElement).value })}
      />
    </>
  )
}

const portionToSnapshot = (p: FoodItemPortion) => ({
  label_quantity: p.label_quantity,
  label_unit: p.label_unit,
  base_equivalent: p.base_equivalent,
})

const MACRO_LABELS: Record<'calories' | 'protein' | 'carbs' | 'fat' | 'fiber', (v: number) => string> = {
  calories: (v) => `${v} kcal`,
  protein: (v) => `P ${v}g`,
  carbs: (v) => `C ${v}g`,
  fat: (v) => `F ${v}g`,
  fiber: (v) => `Fib ${v}g`,
}

function FoodItemRow({
  item,
  index,
  onChange,
  onRemove,
  autoFocus,
}: {
  item: FoodItemEdit
  index: number
  onChange: (index: number, item: FoodItemEdit) => void
  onRemove: (index: number) => void
  autoFocus?: boolean
}) {
  const update = (patch: Partial<FoodItemEdit>) => onChange(index, { ...item, ...patch })

  // Detail (incl. portions + effective_default_portion_id) is cached by
  // react-query keyed on food_item_id; re-renders don't re-fetch.
  const { data: detail } = useQuery({
    enabled: !!item.food_item_id,
    queryFn: () => fetchFoodItemDetailApi(item.food_item_id!),
    queryKey: ['foodItem', item.food_item_id],
  })

  useAutoDefaultPortion(item, detail, (p, keepCount) =>
    update({
      food_item_portion_id: p.id,
      portion_count: keepCount ? (item.portion_count ?? 1) : 1,
      portion: portionToSnapshot(p),
      // Clear the freshness flag — once applied, the row is no longer "new
      // pending auto-default" and shouldn't re-trigger if anything else
      // upstream resets the effect's gate.
      _isNew: false,
      // For existing portion-pinned rows loaded via mealItemsToEdit, `ref`
      // holds the per-entry snapshot (ref.calories = already-scaled, ref.quantity
      // = portion_count × label_quantity), not the canonical (per default_quantity)
      // values that scaleNutrient's portion-path formula requires. Refresh ref
      // from the food's detail so the formula
      //   nutrient × count × base_equivalent / ref.quantity
      // evaluates correctly. (For freshly-picked foods, ref is already canonical
      // from FoodItemEntity, and keepCount=false, so this branch is harmless.)
      ref:
        keepCount && detail
          ? {
              calories: detail.calories,
              carbs: detail.carbs,
              fat: detail.fat,
              fiber: detail.fiber,
              protein: detail.protein,
              quantity: detail.default_quantity,
            }
          : item.ref,
    }),
  )

  const portionScale =
    item.food_item_portion_id && item.portion && typeof item.portion_count === 'number'
      ? { count: item.portion_count, base_equivalent: item.portion.base_equivalent }
      : undefined

  const macros = (['calories', 'protein', 'carbs', 'fat', 'fiber'] as const).map((f) => ({
    field: f,
    value: scaleNutrient(item.ref, f, item.quantity, portionScale),
  }))
  const hasMacros = macros.some((m) => typeof m.value === 'number')

  const handleFoodPick = (fi: FoodItemEntity) =>
    onChange(index, {
      ...item,
      food_item_id: fi.id,
      // Reset portion state — previous food's portions don't apply; the
      // useAutoDefaultPortion effect re-applies the default for the new food.
      food_item_portion_id: undefined,
      portion_count: undefined,
      portion: undefined,
      // Re-flag as fresh-w.r.t.-this-food so the auto-default branch can
      // adopt the new food's effective default portion. (handleFoodPick
      // already resets the quantity to fi.default_quantity, so there's no
      // user data to preserve here — distinct from the load-time case.)
      _isNew: true,
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

  const handlePortionPick = (portionId: string) => {
    if (!portionId) {
      update({
        food_item_portion_id: undefined,
        portion_count: undefined,
        portion: undefined,
        quantity: detail?.default_quantity ?? item.quantity,
        unit: detail?.default_unit ?? item.unit,
      })
      return
    }
    const p = detail?.portions?.find((pp) => pp.id === portionId)
    if (!p) return
    update({
      food_item_portion_id: p.id,
      portion_count:
        item.portion_count && item.food_item_portion_id ? item.portion_count : 1,
      portion: portionToSnapshot(p),
    })
  }

  const baseLabel = `${detail?.default_quantity ?? '?'} ${detail?.default_unit ?? ''}`.trim()

  return (
    <div class="food-item-edit-row">
      <div class="food-row-top">
        <FoodItemAutocomplete
          value={item.name}
          autoFocus={autoFocus}
          onChange={(name) => update({ name })}
          onSelect={handleFoodPick}
          onCreate={(name) => addFoodItemApi({ name })}
        />
        <PortionPicker
          selectedId={item.food_item_portion_id}
          portions={detail?.portions ?? []}
          baseLabel={baseLabel}
          onPick={handlePortionPick}
        />
        <QuantityInputs item={item} onUpdate={update} />
        <button type="button" class="btn-danger-small" onClick={() => onRemove(index)}>
          &times;
        </button>
      </div>
      {hasMacros && (
        <div class="food-row-macros-display">
          {macros.map((m) =>
            typeof m.value === 'number' ? <span key={m.field}>{MACRO_LABELS[m.field](m.value)}</span> : null,
          )}
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
  const [autoFocusIndex, setAutoFocusIndex] = useState<number | null>(null)

  const handleChange = (index: number, item: FoodItemEdit) => {
    const next = [...items]
    next[index] = item
    onChange(next)
  }
  const handleRemove = (index: number) => onChange(items.filter((_, i) => i !== index))
  const handleAdd = () => {
    setAutoFocusIndex(items.length)
    // _isNew flags this row as added this session so useAutoDefaultPortion
    // can adopt the food's effective default portion on pick. Rows loaded
    // from the server via mealItemsToEdit don't carry the flag and are
    // never silently re-encoded by the auto-default branch.
    onChange([...items, { name: '', _isNew: true }])
  }

  return (
    <div class="food-items-editor">
      {items.map((item, i) => (
        <FoodItemRow
          key={i}
          item={item}
          index={i}
          onChange={handleChange}
          onRemove={handleRemove}
          autoFocus={i === autoFocusIndex}
        />
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

  const { data: sensitivityFlags = [] } = useQuery({
    queryFn: fetchSensitivityFlags,
    queryKey: ['sensitivityFlags'],
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

  // Stable ref to the latest save callback so the debounced flushers always
  // invoke the most recent closure rather than one captured at first render.
  const saveRef = useRef<(body: UpdateMealBody) => void>(() => {})
  // Two flushers — food-items edits debounce 600 ms (mostly autocomplete +
  // qty/unit typing), meal_type custom edits debounce 600 ms too. Both
  // flush synchronously on unmount so navigating away mid-debounce doesn't
  // drop the user's last edit (the bug behind "Back doesn't show new item").
  const itemsFlusherRef = useRef(
    createDebouncedFlusher<UpdateMealBody>(FOOD_ITEM_DEBOUNCE_MS, (body) => saveRef.current(body)),
  )
  // Serialized last-saved food_items body — used by commitItems to de-dupe
  // identical-payload schedules so on-load backfills don't trigger writes.
  const lastItemsBodyRef = useRef<string | null>(null)
  const mealTypeFlusherRef = useRef(
    createDebouncedFlusher<string>(FOOD_ITEM_DEBOUNCE_MS, (v) => saveRef.current({ meal_type: v })),
  )

  // The previous unmount-time invalidate of ['meals'] was redundant — every
  // save mutation already invalidates the list. It also caused a flicker when
  // a flushed save and the manual invalidate raced. Removed.

  // Clear pending flash timer + flush both debouncers on unmount so any
  // mid-debounce edit is persisted before the route changes.
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
      itemsFlusherRef.current.flush()
      mealTypeFlusherRef.current.flush()
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
    // No meal_type means this was created via the ad-hoc flow — the user
    // explicitly opted out of a slot, so treat it as a custom "other" rather
    // than silently defaulting to lunch.
    setMealType(meal.meal_type ?? DEFAULT_CUSTOM_TYPE)
    const initialItems = mealItemsToEdit(meal.food_items)
    setItems(initialItems)
    // Seed the de-dupe ref so the first commitItems call (typically from
    // useAutoDefaultPortion's backfill) doesn't fire a no-op write.
    lastItemsBodyRef.current = JSON.stringify({ food_items: editItemsToBody(initialItems) })
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
  // Keep the debouncers' save callback up to date with the latest closure.
  saveRef.current = save

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

  const flagAreas: string[] = sensitivityFlags.map((f) => f.name)

  const commitItems = (next: FoodItemEdit[]) => {
    setItems(next)
    // Filter rows that are mid-edit on a portion (pinned to a portion but
    // the count input is currently empty/zero). Without this, such a row
    // would fall through editItemsToBody's portion fork and briefly get
    // re-saved as a legacy-quantity row, then re-pinned when the count
    // refills. We skip the offending row only (not the whole save), so
    // edits to other rows still flush.
    const saveable = next.filter(
      (fi) => !(fi.food_item_portion_id && !(typeof fi.portion_count === 'number' && fi.portion_count > 0)),
    )
    const body = { food_items: editItemsToBody(saveable) }
    // De-dupe consecutive identical bodies — useAutoDefaultPortion's
    // backfill on load propagates through here with the same
    // food_item_portion_id + portion_count the server already has, and
    // there's no reason to round-trip a no-op write per detail-page open.
    const serialized = JSON.stringify(body)
    if (serialized === lastItemsBodyRef.current) return
    lastItemsBodyRef.current = serialized
    itemsFlusherRef.current.schedule(body)
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
                if (v === (meal.meal_type ?? '')) return
                if ((MEAL_TYPES as readonly string[]).includes(v)) {
                  // Dropdown selection — commit immediately, the debounce is
                  // only meaningful for free-text custom-type keystrokes.
                  mealTypeFlusherRef.current.cancel()
                  save({ meal_type: v })
                } else {
                  mealTypeFlusherRef.current.schedule(v)
                }
              }}
              onCustomCommit={(v) => {
                // Blur of the custom input — flush any pending debounced save
                // so the final value is persisted without waiting out the
                // debounce window.
                if (v !== (meal.meal_type ?? '')) {
                  mealTypeFlusherRef.current.cancel()
                  save({ meal_type: v })
                }
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
