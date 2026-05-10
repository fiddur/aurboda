import type { FrequentFoodItem } from '@aurboda/api-spec'

import { NUTRIENT_FIELDS } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfDay, format, formatISO, startOfDay } from 'date-fns'
import { useLocation } from 'preact-iso'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import { ConfirmButton } from '../../components/ConfirmButton'
import { DateNav } from '../../components/DateNav'
import {
  addMealApi,
  deleteMealApi,
  fetchFrequentFoodItemsApi,
  fetchMeals,
  fetchSensitivityFlags,
  fetchUserSettings,
  type Meal,
  type MealsResult,
  setFoodItemSensitivities,
  setMealLogCompletedApi,
  unsetMealLogCompletedApi,
  updateMealApi,
} from '../../state/api'
import { auth } from '../../state/auth'
import { isEmoji, isIconPath, isUrl } from '../../utils/emojiLookup'
import { MealsOverview } from './MealsOverview'
import './style.css'

interface MealSlot {
  name: string
  default_hour: number
}

const DEFAULT_MEAL_SLOTS: MealSlot[] = [
  { name: 'Breakfast', default_hour: 7 },
  { name: 'Lunch', default_hour: 12 },
  { name: 'Snack', default_hour: 15 },
  { name: 'Dinner', default_hour: 18 },
]

const formatTime = (hour: number, minute: number): string => `${hour}:${String(minute).padStart(2, '0')}`

/** Convert total minutes since midnight to HH:MM string. */
const minutesToTime = (totalMinutes: number): string => {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return formatTime(h, m)
}

const formatMealType = (type?: string): string =>
  type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Meal'

const findMealsForSlot = (meals: Meal[], slotName: string): Meal[] =>
  meals.filter((m) => m.meal_type === slotName.toLowerCase())

/**
 * A clickable food item chip with a popover for managing sensitivity flags.
 * The chip toggles the food item's flag assignments via the food-item ↔ flag
 * junction (PUT /food-items/:id/sensitivities), so a flag attached here
 * applies wherever this food item shows up — past meal snapshots stay frozen,
 * future meals inherit the new tag at log time.
 */
function FoodItemChip({
  name,
  foodItemId,
  initialFlagNames,
  flags,
}: {
  name: string
  foodItemId?: string
  /** Flag names snapshotted on the meal-junction row — used as the initial popover state. */
  initialFlagNames: string[]
  /** Full flag list from /sensitivity-flags. */
  flags: Array<{ id: string; name: string }>
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const queryClient = useQueryClient()
  // Local optimistic state of which flag IDs are currently assigned. Seeded
  // from the meal snapshot — the chip doesn't fetch live state to avoid an
  // extra round trip per chip on page load. The seed is re-synced via
  // useEffect below whenever the meal-junction snapshot or the flag list
  // changes, so a refetch from another tab isn't masked by stale state.
  const [localFlagIds, setLocalFlagIds] = useState<Set<string>>(new Set())
  const initialKey = `${initialFlagNames.join('|')}::${flags.map((f) => f.id).join('|')}`
  useEffect(() => {
    const next = new Set<string>()
    for (const flag of flags) {
      if (initialFlagNames.includes(flag.name)) next.add(flag.id)
    }
    setLocalFlagIds(next)
    // initialKey is a stable hash of the inputs — using it as the dep keeps
    // the comparison shallow without rebuilding the set on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [open])

  const setFlagsMutation = useMutation({
    mutationFn: (flagIds: string[]) => {
      if (!foodItemId) return Promise.resolve()
      return setFoodItemSensitivities(foodItemId, flagIds)
    },
    // The flag change applies to FUTURE meals immediately. Historical meal
    // snapshots stay frozen until the user hits "re-snapshot" on the
    // food-item page — invalidate the meals query so the re-fetch shows
    // any newly-snapshotted state, but the chip dot for past meals stays
    // until those snapshots are refreshed.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodItem', foodItemId] })
      queryClient.invalidateQueries({ queryKey: ['meals'] })
    },
  })

  const toggleFlag = (flagId: string, checked: boolean) => {
    const next = new Set(localFlagIds)
    if (checked) next.add(flagId)
    else next.delete(flagId)
    setLocalFlagIds(next)
    setFlagsMutation.mutate([...next])
  }

  const hasMappings = localFlagIds.size > 0

  return (
    <span ref={ref} class={`food-item-chip ${hasMappings ? 'mapped' : ''}`} onClick={() => setOpen(!open)}>
      {name}
      {hasMappings && <span class="mapping-dot" />}
      {open && flags.length > 0 && (
        <div class="food-map-popover" onClick={(e) => e.stopPropagation()}>
          <div class="popover-title">
            Flags for{' '}
            {foodItemId ? (
              <a href={`/food-items/${foodItemId}`} class="popover-title-link">
                "{name}"
              </a>
            ) : (
              `"${name}"`
            )}
          </div>
          {!foodItemId && <p class="popover-note">No food-item id — flags can't be saved.</p>}
          {flags.map((flag) => (
            <label key={flag.id} class="popover-option">
              <input
                type="checkbox"
                checked={localFlagIds.has(flag.id)}
                disabled={!foodItemId}
                onChange={(e) => toggleFlag(flag.id, (e.target as HTMLInputElement).checked)}
              />
              {flag.name}
            </label>
          ))}
        </div>
      )}
    </span>
  )
}

function MealDetails({ meal, flags }: { meal: Meal; flags: Array<{ id: string; name: string }> }) {
  const hasFoodItems = meal.food_items && meal.food_items.length > 0
  const hasCalories = meal.calories !== undefined
  const hasContent = meal.name || hasFoodItems || meal.notes || hasCalories

  if (!hasContent) return null

  return (
    <div class="meal-details">
      {meal.name && (
        <a href={`/meals/${meal.id}`} class="meal-name">
          {meal.name}
        </a>
      )}
      {hasFoodItems && (
        <div class="food-items">
          {meal.food_items!.map((item, i) => (
            <FoodItemChip
              key={i}
              name={item.name}
              foodItemId={item.food_item_id}
              initialFlagNames={item.sensitivities ?? []}
              flags={flags}
            />
          ))}
        </div>
      )}
      {hasCalories && (
        <span class="meal-calories">
          {meal.nutrient_data_incomplete && (
            <span class="incomplete-indicator" title="Some food items lack nutrient data">
              ~
            </span>
          )}
          {meal.calories} kcal
        </span>
      )}
      {meal.notes && <div class="meal-notes">{meal.notes}</div>}
      {meal.source && meal.source !== 'manual' && <span class="meal-source">via {meal.source}</span>}
    </div>
  )
}

/**
 * Group frequent food items by icon. Items without an icon become
 * single-entry chips keyed by name. Items sharing an icon collapse to one
 * chip that opens a name picker on tap.
 */
const groupFoodItemsByIcon = (
  items: FrequentFoodItem[],
): Array<{ icon: string | null; items: FrequentFoodItem[] }> => {
  const byIcon = new Map<string, FrequentFoodItem[]>()
  const noIcon: FrequentFoodItem[] = []
  for (const item of items) {
    if (!item.icon) {
      noIcon.push(item)
      continue
    }
    const list = byIcon.get(item.icon) ?? []
    list.push(item)
    byIcon.set(item.icon, list)
  }
  const groups: Array<{ icon: string | null; items: FrequentFoodItem[] }> = []
  for (const [icon, list] of byIcon) groups.push({ icon, items: list })
  for (const item of noIcon) groups.push({ icon: null, items: [item] })
  return groups
}

/** Render an icon string the right way: emoji inline, URL/icon-path as <img>. */
function ChipIcon({ icon, size = 24 }: { icon: string; size?: number }) {
  if (isUrl(icon) || isIconPath(icon)) {
    return <img class="frequent-icon-img" src={icon} alt="" width={size} height={size} />
  }
  if (isEmoji(icon)) return <span class="frequent-icon">{icon}</span>
  // Fallback: short text (initials, custom token).
  return <span class="frequent-icon">{icon}</span>
}

function FrequentFoodItemsStrip({
  slotName,
  onQuickLog,
}: {
  slotName: string
  onQuickLog: (foodItem: FrequentFoodItem) => void
}) {
  const mealType = slotName.toLowerCase()
  const { data: frequent } = useQuery({
    queryFn: () => fetchFrequentFoodItemsApi({ limit: 8, meal_type: mealType }),
    queryKey: ['frequentFoodItems', mealType],
    staleTime: 5 * 60_000,
  })

  const [openIcon, setOpenIcon] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openIcon) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpenIcon(null)
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [openIcon])

  if (!frequent || frequent.length === 0) return null

  const groups = groupFoodItemsByIcon(frequent)

  return (
    <div ref={wrapperRef} class="frequent-meals-strip">
      {groups.map((group) => {
        const single = group.items[0]
        const ambiguous = group.items.length > 1
        const key = group.icon ?? `noicon:${single.food_item_id}`

        if (!ambiguous) {
          return (
            <button
              key={key}
              type="button"
              class="frequent-chip"
              title={`Log ${single.name}`}
              onClick={() => onQuickLog(single)}
            >
              {group.icon ? <ChipIcon icon={group.icon} /> : null}
              <span class="frequent-name">{single.name}</span>
            </button>
          )
        }

        // When several food items share the same icon, the chip shows just
        // the icon and tapping it opens a picker — matches the user spec
        // "click the icon to choose which one to log".
        const isOpen = openIcon === group.icon
        const names = group.items.map((i) => i.name).join(', ')
        return (
          <div key={key} class="frequent-chip-group">
            <button
              type="button"
              class="frequent-chip frequent-chip-multi"
              title={`Choose: ${names}`}
              aria-label={`Choose ${slotName.toLowerCase()}: ${names}`}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onClick={() => setOpenIcon(isOpen ? null : group.icon)}
            >
              {group.icon && <ChipIcon icon={group.icon} />}
              <span class="frequent-multi-caret">▾</span>
            </button>
            {isOpen && (
              <div class="frequent-picker" onClick={(e) => e.stopPropagation()}>
                {group.items.map((item) => (
                  <button
                    key={item.food_item_id}
                    type="button"
                    class="frequent-picker-item"
                    onClick={() => {
                      setOpenIcon(null)
                      onQuickLog(item)
                    }}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface MealSlotRowProps {
  slot: MealSlot
  meals: Meal[]
  sensitivityAreas: string[]
  flags: Array<{ id: string; name: string }>
  onToggleSensitivity: (slot: MealSlot, area: string, existingMeal?: Meal) => void
  onChangeTime: (meal: Meal, hour: number, minute?: number) => void
  onCreateAtTime: (slot: MealSlot, hour: number, minute: number) => void
  onCreateAndOpen: (slot: MealSlot) => void
  onQuickLog: (slot: MealSlot, hour: number, minute: number, foodItem: FrequentFoodItem) => void
  onDelete: (id: string) => void
  isDeletePending: boolean
  isSaving: boolean
}

function MealSlotRow({
  slot,
  meals: slotMeals,
  sensitivityAreas,
  flags,
  onToggleSensitivity,
  onChangeTime,
  onCreateAtTime,
  onCreateAndOpen,
  onQuickLog,
  onDelete,
  isDeletePending,
  isSaving,
}: MealSlotRowProps) {
  const primaryMeal = slotMeals[0]
  const explicit = primaryMeal?.sensitivities ?? []
  const derived = derivedSensitivities(primaryMeal)
  // Union of explicit + derived — checkbox shows checked if either
  const effectiveSensitivities = new Set([...explicit, ...derived])
  const mealH = primaryMeal ? primaryMeal.time.getHours() : slot.default_hour
  const mealM = primaryMeal ? primaryMeal.time.getMinutes() : 0

  // Slider range: ±1.5 hours from default, clamped to 0–23:55
  const sliderMin = Math.max(0, (slot.default_hour - 1.5) * 60)
  const sliderMax = Math.min(23 * 60 + 55, (slot.default_hour + 1.5) * 60)
  const currentMinutes = mealH * 60 + mealM
  const [sliderValue, setSliderValue] = useState(currentMinutes)
  const draggingRef = useRef(false)

  // Sync slider position with actual meal time when not dragging
  useEffect(() => {
    if (!draggingRef.current) setSliderValue(mealH * 60 + mealM)
  }, [mealH, mealM])

  const handleSliderRelease = () => {
    draggingRef.current = false
    const hour = Math.floor(sliderValue / 60)
    const minute = sliderValue % 60
    if (primaryMeal) {
      onChangeTime(primaryMeal, hour, minute)
    } else {
      onCreateAtTime(slot, hour, minute)
    }
  }

  return (
    <div class={`meal-slot-row ${primaryMeal ? 'has-meal' : ''}`}>
      <div class="slot-top">
        <a href={`/meal-type/${encodeURIComponent(slot.name.toLowerCase())}`} class="slot-name">
          {slot.name}
        </a>

        <div class="time-slider-wrapper">
          <span class="time-label">{minutesToTime(sliderValue)}</span>
          <input
            type="range"
            class="time-slider"
            min={sliderMin}
            max={sliderMax}
            step={5}
            value={sliderValue}
            onInput={(e) => {
              draggingRef.current = true
              setSliderValue(parseInt((e.target as HTMLInputElement).value, 10))
            }}
            onMouseUp={handleSliderRelease}
            onTouchEnd={handleSliderRelease}
          />
          {isSaving && <span class="saving-indicator" />}
        </div>

        <div class="slot-actions">
          {primaryMeal ? (
            <a
              href={`/meals/${primaryMeal.id}`}
              class="meal-edit-link"
              title="Edit meal details"
              aria-label="Edit meal"
            >
              ✎
            </a>
          ) : (
            <button
              type="button"
              class="meal-edit-link"
              title="Create meal and edit details"
              onClick={() => onCreateAndOpen(slot)}
            >
              +
            </button>
          )}

          {primaryMeal && (
            <ConfirmButton
              label="Delete"
              confirmMessage="Delete this meal?"
              onConfirm={() => onDelete(primaryMeal.id!)}
              isPending={isDeletePending}
              pendingLabel="Deleting..."
              buttonClass="btn-danger-small"
            />
          )}
        </div>
      </div>

      {!primaryMeal && (
        <FrequentFoodItemsStrip
          slotName={slot.name}
          onQuickLog={(foodItem) => {
            const hour = Math.floor(sliderValue / 60)
            const minute = sliderValue % 60
            onQuickLog(slot, hour, minute, foodItem)
          }}
        />
      )}

      {sensitivityAreas.length > 0 && (
        <div class="sensitivity-checks">
          {sensitivityAreas.map((area) => {
            const isDerived = derived.has(area)
            const isExplicit = explicit.includes(area)
            return (
              <label key={area} class={`sensitivity-label ${isDerived && !isExplicit ? 'derived' : ''}`}>
                <input
                  type="checkbox"
                  checked={effectiveSensitivities.has(area)}
                  onChange={() => onToggleSensitivity(slot, area, primaryMeal)}
                />
                {area}
              </label>
            )
          })}
        </div>
      )}

      {primaryMeal && <MealDetails meal={primaryMeal} flags={flags} />}

      {/*
       * If the slot has more than one meal (intentional split — two snacks
       * at different times — or the rare double-tap on the quick-log strip),
       * render each additional meal as its own row with time + edit + delete
       * so the duplicates are obvious and individually manageable.
       */}
      {slotMeals.slice(1).map((meal) => (
        <DuplicateMealRow
          key={meal.id}
          meal={meal}
          flags={flags}
          onDelete={onDelete}
          isDeletePending={isDeletePending}
        />
      ))}
    </div>
  )
}

const NUTRIENT_CATEGORIES = [
  { key: 'macro', label: 'Macros' },
  { key: 'extended_macro', label: 'Extended' },
  { key: 'fat_breakdown', label: 'Fats' },
  { key: 'vitamin', label: 'Vitamins' },
  { key: 'mineral', label: 'Minerals' },
  { key: 'amino_acid', label: 'Amino Acids' },
] as const

/** Aggregate nutrients from all meals for the day. */
const aggregateDayNutrients = (meals: Meal[]): Record<string, number> => {
  const totals: Record<string, number> = {}
  for (const meal of meals) {
    if (!meal.nutrients) continue
    for (const [key, val] of Object.entries(meal.nutrients)) {
      if (typeof val === 'number' && val > 0) totals[key] = (totals[key] ?? 0) + val
    }
  }
  for (const key of Object.keys(totals)) totals[key] = Math.round(totals[key] * 100) / 100
  return totals
}

function DayNutrientSummary({ meals }: { meals: Meal[] }) {
  const nutrients = aggregateDayNutrients(meals)
  const hasNutrients = Object.keys(nutrients).length > 0
  const isIncomplete = meals.some((m) => m.nutrient_data_incomplete)

  return (
    <div class={`day-nutrient-summary${hasNutrients ? '' : ' empty'}`}>
      {!hasNutrients ? (
        <p class="no-nutrients">No nutrient data for this day.</p>
      ) : (
        <>
          <h3>Day Totals</h3>
          {isIncomplete && (
            <p class="incomplete-notice">Some food items lack nutrient data — totals may be understated.</p>
          )}
          {NUTRIENT_CATEGORIES.map(({ key, label }) => {
            const fields = NUTRIENT_FIELDS.filter(
              (f) => f.category === key && nutrients[f.name] !== undefined,
            )
            if (fields.length === 0) return null
            return (
              <div key={key} class="day-nutrient-group">
                <h4>{label}</h4>
                {fields.map((f) => (
                  <div key={f.name} class="day-nutrient-line">
                    <span>{f.label}</span>
                    <span>
                      {nutrients[f.name].toFixed(1)} {f.unit}
                    </span>
                  </div>
                ))}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

/**
 * A second-or-later meal in the same slot. Rendered below the primary meal
 * with its own time, edit, and delete affordances so users can manage each
 * one individually (intentional split, or the rare double-click duplicate).
 */
function DuplicateMealRow({
  meal,
  flags,
  onDelete,
  isDeletePending,
}: {
  meal: Meal
  flags: Array<{ id: string; name: string }>
  onDelete: (id: string) => void
  isDeletePending: boolean
}) {
  return (
    <div class="duplicate-meal-row">
      <div class="duplicate-meal-top">
        <span class="duplicate-meal-time">{format(meal.time, 'HH:mm')}</span>
        <div class="slot-actions">
          <a
            href={`/meals/${meal.id}`}
            class="meal-edit-link"
            title="Edit meal details"
            aria-label="Edit meal"
          >
            ✎
          </a>
          <ConfirmButton
            label="Delete"
            confirmMessage="Delete this meal?"
            onConfirm={() => onDelete(meal.id!)}
            isPending={isDeletePending}
            pendingLabel="Deleting..."
            buttonClass="btn-danger-small"
          />
        </div>
      </div>
      <MealDetails meal={meal} flags={flags} />
    </div>
  )
}

function OtherMealRow({
  meal,
  onDelete,
  isDeletePending,
  flags,
}: {
  meal: Meal
  onDelete: (id: string) => void
  isDeletePending: boolean
  flags: Array<{ id: string; name: string }>
}) {
  return (
    <div class="meal-slot-row has-meal">
      <div class="slot-top">
        <a href={`/meal-type/${encodeURIComponent(meal.meal_type ?? 'default')}`} class="slot-name">
          {formatMealType(meal.meal_type)}
        </a>
        <span class="meal-time">{format(meal.time, 'HH:mm')}</span>
        <div class="slot-actions">
          <a
            href={`/meals/${meal.id}`}
            class="meal-edit-link"
            title="Edit meal details"
            aria-label="Edit meal"
          >
            ✎
          </a>
          <ConfirmButton
            label="Delete"
            confirmMessage="Delete this meal?"
            onConfirm={() => onDelete(meal.id!)}
            isPending={isDeletePending}
            pendingLabel="Deleting..."
            buttonClass="btn-danger-small"
          />
        </div>
      </div>
      <MealDetails meal={meal} flags={flags} />
    </div>
  )
}

const todayISO = () => formatISO(new Date(), { representation: 'date' })

/**
 * Compute sensitivities derived from food items. Reads each food_item's
 * snapshotted `sensitivities[]` (set at meal-add time from the food item's
 * current flag assignments — see services/meals.ts). No name-keyed map
 * lookup any more — the food_item ↔ flag junction is the source of truth.
 */
const derivedSensitivities = (meal: Meal | undefined): Set<string> => {
  const derived = new Set<string>()
  for (const item of meal?.food_items ?? []) {
    for (const flag of item.sensitivities ?? []) derived.add(flag)
  }
  return derived
}

type TimelineEntry =
  | { kind: 'slot'; slot: MealSlot; minutes: number }
  | { kind: 'other'; meal: Meal; minutes: number }

const minutesOfDay = (d: Date): number => d.getHours() * 60 + d.getMinutes()

const buildTimeline = (slots: MealSlot[], meals: Meal[]): TimelineEntry[] => {
  const slotTypes = new Set(slots.map((s) => s.name.toLowerCase()))
  const slotEntries: TimelineEntry[] = slots.map((slot) => {
    const m = meals.find((meal) => meal.meal_type === slot.name.toLowerCase())
    return { kind: 'slot', minutes: m ? minutesOfDay(m.time) : slot.default_hour * 60, slot }
  })
  const otherEntries: TimelineEntry[] = meals
    .filter((m) => !slotTypes.has(m.meal_type ?? ''))
    .map((meal) => ({ kind: 'other', meal, minutes: minutesOfDay(meal.time) }))
  return [...slotEntries, ...otherEntries].sort((a, b) => a.minutes - b.minutes)
}

/** Hook to manage meal mutations with optimistic updates. */
function useMealMutations(mealsQueryKey: string[], meals: Meal[] | undefined) {
  const queryClient = useQueryClient()
  const [savingSlots, setSavingSlots] = useState(new Set<string>())

  const markSlotSaving = (slotName: string, saving: boolean) => {
    setSavingSlots((prev) => {
      const next = new Set(prev)
      if (saving) next.add(slotName)
      else next.delete(slotName)
      return next
    })
  }

  const optimisticUpdate = useCallback(
    (updater: (old: Meal[]) => Meal[]) => {
      queryClient.setQueryData<MealsResult>(mealsQueryKey, (old) => ({
        meals: updater(old?.meals ?? []),
        log_completed: old?.log_completed,
      }))
    },
    [queryClient, mealsQueryKey],
  )

  const invalidateMeals = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['meals'] }),
    [queryClient],
  )

  const upsertMutation = useMutation({
    mutationFn: addMealApi,
    onSettled: (_data, _err, variables) => {
      if (variables.meal_type) markSlotSaving(variables.meal_type, false)
      invalidateMeals()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string; sensitivities?: string[]; time?: string }) =>
      updateMealApi(id, body),
    onSettled: (_data, _err, variables) => {
      const meal = (meals ?? []).find((m) => m.id === variables.id)
      if (meal?.meal_type) markSlotSaving(meal.meal_type, false)
      invalidateMeals()
    },
  })

  const deleteMutation = useMutation({ mutationFn: deleteMealApi, onSuccess: invalidateMeals })

  const toggleCompletedMutation = useMutation({
    mutationFn: (params: { dayKey: string; completed: boolean }) =>
      params.completed ? unsetMealLogCompletedApi(params.dayKey) : setMealLogCompletedApi(params.dayKey),
    onMutate: () => {
      queryClient.setQueryData<MealsResult>(mealsQueryKey, (old) =>
        old ? { ...old, log_completed: !old.log_completed } : old,
      )
    },
    onSettled: invalidateMeals,
  })

  const handleToggleSensitivity = (slot: MealSlot, area: string, existingMeal?: Meal) => {
    const slotName = slot.name.toLowerCase()
    markSlotSaving(slotName, true)

    if (existingMeal) {
      const current = existingMeal.sensitivities ?? []
      const next = current.includes(area) ? current.filter((s) => s !== area) : [...current, area]
      optimisticUpdate((old) =>
        old.map((m) => (m.id === existingMeal.id ? { ...m, sensitivities: next } : m)),
      )
      updateMutation.mutate({ id: existingMeal.id!, sensitivities: next })
    } else {
      const id = crypto.randomUUID()
      const mealTime = new Date(mealsQueryKey[1])
      mealTime.setHours(slot.default_hour, 0, 0, 0)
      const placeholder: Meal = {
        id,
        meal_type: slotName,
        sensitivities: [area],
        source: 'manual',
        time: mealTime,
      }
      optimisticUpdate((old) => [...old, placeholder])
      upsertMutation.mutate({
        id,
        meal_type: slotName,
        sensitivities: [area],
        source: 'manual',
        time: mealTime.toISOString(),
      })
    }
  }

  const handleChangeTime = (meal: Meal, hour: number, minute = 0) => {
    const newTime = new Date(meal.time)
    newTime.setHours(hour, minute, 0, 0)
    optimisticUpdate((old) => old.map((m) => (m.id === meal.id ? { ...m, time: newTime } : m)))
    if (meal.meal_type) markSlotSaving(meal.meal_type, true)
    updateMutation.mutate({ id: meal.id!, time: newTime.toISOString() })
  }

  return {
    savingSlots,
    handleToggleSensitivity,
    handleChangeTime,
    optimisticUpdate,
    markSlotSaving,
    upsertMutation,
    updateMutation,
    deleteMutation,
    toggleCompletedMutation,
  }
}

// eslint-disable-next-line complexity -- React component with many hooks and conditional renders
function MealsContent({ dayKey }: { dayKey: string }) {
  const isLoggedIn = auth.value.token
  const { route } = useLocation()
  const queryClient = useQueryClient()

  const { data: settings } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const mealSlots = settings?.meal_slots?.length ? settings.meal_slots : DEFAULT_MEAL_SLOTS

  const { data: flagsData = [] } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchSensitivityFlags,
    queryKey: ['sensitivityFlags'],
  })
  const flags = flagsData.map((f) => ({ id: f.id, name: f.name }))
  const sensitivityAreas = flags.map((f) => f.name)

  const selectedDate = new Date(dayKey)
  const dayStart = startOfDay(selectedDate)
  const dayEnd = endOfDay(selectedDate)
  const mealsQueryKey = ['meals', dayKey]

  const { data: mealsResult, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchMeals({ start: dayStart.toISOString(), end: dayEnd.toISOString(), date: dayKey }),
    queryKey: mealsQueryKey,
    staleTime: 30_000,
  })

  const meals = mealsResult?.meals
  const isDayCompleted = mealsResult?.log_completed ?? false

  const {
    savingSlots,
    handleToggleSensitivity,
    handleChangeTime,
    optimisticUpdate,
    markSlotSaving,
    upsertMutation,
    updateMutation,
    deleteMutation,
    toggleCompletedMutation,
  } = useMealMutations(mealsQueryKey, meals)

  const handleCreateAndOpen = async (slot: MealSlot) => {
    const id = crypto.randomUUID()
    const mealTime = new Date(dayKey)
    mealTime.setHours(slot.default_hour, 0, 0, 0)
    await addMealApi({
      id,
      meal_type: slot.name.toLowerCase(),
      source: 'manual',
      time: mealTime.toISOString(),
    })
    queryClient.invalidateQueries({ queryKey: ['meals'] })
    route(`/meals/${id}`)
  }

  const handleCreateAtTime = (slot: MealSlot, hour: number, minute: number) => {
    const slotName = slot.name.toLowerCase()
    const id = crypto.randomUUID()
    const mealTime = new Date(dayKey)
    mealTime.setHours(hour, minute, 0, 0)
    optimisticUpdate((old) => [...old, { id, meal_type: slotName, source: 'manual', time: mealTime }])
    markSlotSaving(slotName, true)
    upsertMutation.mutate({
      id,
      meal_type: slotName,
      source: 'manual',
      time: mealTime.toISOString(),
    })
  }

  const handleQuickLog = (slot: MealSlot, hour: number, minute: number, foodItem: FrequentFoodItem) => {
    const slotName = slot.name.toLowerCase()
    const id = crypto.randomUUID()
    const mealTime = new Date(dayKey)
    mealTime.setHours(hour, minute, 0, 0)
    const foodItemPayload = {
      food_item_id: foodItem.food_item_id,
      icon: foodItem.icon ?? undefined,
      name: foodItem.name,
      quantity: foodItem.last_quantity ?? undefined,
      unit: foodItem.last_unit ?? undefined,
    }
    // Optimistically inject the meal into the cache so the UI flips from
    // "show quick-log strip" to "show the new meal" immediately. Without
    // this the user has no feedback during the network round-trip and may
    // double-click and create duplicate meals.
    const placeholder: Meal = {
      food_items: [foodItemPayload],
      id,
      meal_type: slotName,
      source: 'manual',
      time: mealTime,
    }
    optimisticUpdate((old) => [...old, placeholder])
    markSlotSaving(slotName, true)
    upsertMutation.mutate({
      id,
      meal_type: slotName,
      // No meal name — quick-log creates a meal containing just this one
      // food item; the user can edit/expand from the detail page.
      food_items: [foodItemPayload],
      source: 'manual',
      time: mealTime.toISOString(),
    })
  }

  const handleCreateAdHocMeal = async () => {
    const id = crypto.randomUUID()
    const mealTime = new Date()
    const dayDate = new Date(dayKey)
    mealTime.setFullYear(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate())
    // Default to a custom "other" meal_type so the editor shows custom mode
    // instead of silently defaulting to lunch. The user can rename freely.
    await addMealApi({
      id,
      meal_type: 'other',
      source: 'manual',
      time: mealTime.toISOString(),
    })
    queryClient.invalidateQueries({ queryKey: ['meals'] })
    route(`/meals/${id}`)
  }

  if (!isLoggedIn) return <p>Please log in to use meal tracking.</p>
  if (isLoading) return <p class="loading">Loading...</p>

  const isToday = dayKey === todayISO()

  return (
    <div class="day-layout">
      <div class="day-main">
        {sensitivityAreas.length === 0 && (
          <p class="config-hint">
            Configure your meal flags and meal slots in <a href="/settings">Settings</a>.
          </p>
        )}

        <div class="meal-slots">
          {buildTimeline(mealSlots, meals ?? []).map((entry) =>
            entry.kind === 'slot' ? (
              <MealSlotRow
                key={`slot:${entry.slot.name}`}
                slot={entry.slot}
                meals={findMealsForSlot(meals ?? [], entry.slot.name)}
                sensitivityAreas={sensitivityAreas}
                flags={flags}
                onToggleSensitivity={handleToggleSensitivity}
                onChangeTime={handleChangeTime}
                onCreateAtTime={handleCreateAtTime}
                onCreateAndOpen={handleCreateAndOpen}
                onQuickLog={handleQuickLog}
                onDelete={(id) => deleteMutation.mutate(id)}
                isDeletePending={deleteMutation.isPending}
                isSaving={savingSlots.has(entry.slot.name.toLowerCase())}
              />
            ) : (
              <OtherMealRow
                key={`meal:${entry.meal.id}`}
                meal={entry.meal}
                onDelete={(id) => deleteMutation.mutate(id)}
                isDeletePending={deleteMutation.isPending}
                flags={flags}
              />
            ),
          )}
        </div>

        <button type="button" class="btn-add-meal" onClick={handleCreateAdHocMeal}>
          + Add meal
        </button>

        <div class="log-completion">
          <label class="completion-label">
            <input
              type="checkbox"
              checked={isDayCompleted}
              onChange={() => toggleCompletedMutation.mutate({ dayKey, completed: isDayCompleted })}
              disabled={toggleCompletedMutation.isPending}
            />
            Logging complete for {isToday ? 'today' : format(selectedDate, 'MMM d')}
          </label>
        </div>

        {(upsertMutation.isError || updateMutation.isError) && (
          <p class="error-message">Something went wrong. Please try again.</p>
        )}
      </div>

      <DayNutrientSummary meals={meals ?? []} />
    </div>
  )
}

type MealsView = 'day' | 'overview'

const parseView = (raw: string | null): MealsView => (raw === 'overview' ? 'overview' : 'day')

export function Meals() {
  const { query: urlQuery, route } = useLocation()
  const params = new URLSearchParams(urlQuery)
  const view = parseView(params.get('view'))

  const dateParam = params.get('date')
  const dayKey = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayISO()

  const setDayKey = (date: string) => {
    if (date === todayISO()) route('/meals')
    else route(`/meals?date=${date}`)
  }

  const switchView = (next: MealsView) => {
    if (next === 'day') route('/meals')
    else route('/meals?view=overview')
  }

  return (
    <div class="meals-page">
      <div class="meals-header">
        <h1>Meals</h1>
        <div class="meals-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'day'}
            class={`meals-tab ${view === 'day' ? 'active' : ''}`}
            onClick={() => switchView('day')}
          >
            Day
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'overview'}
            class={`meals-tab ${view === 'overview' ? 'active' : ''}`}
            onClick={() => switchView('overview')}
          >
            Overview
          </button>
        </div>
        {view === 'day' && <DateNav value={dayKey} onChange={setDayKey} />}
      </div>
      {view === 'day' ? <MealsContent dayKey={dayKey} /> : <MealsOverview />}
    </div>
  )
}
