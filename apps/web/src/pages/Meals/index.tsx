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
  fetchMeals,
  fetchUserSettings,
  type Meal,
  type MealsResult,
  setMealLogCompletedApi,
  unsetMealLogCompletedApi,
  updateMealApi,
  updateUserSettings,
} from '../../state/api'
import { auth } from '../../state/auth'
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

interface TimeOption {
  hour: number
  minute: number
  label: string
}

/** Build time selector options: preset hours ± 1, plus the actual meal time if non-round. */
const buildTimeOptions = (defaultHour: number, mealHour: number, mealMinute: number): TimeOption[] => {
  const presets: TimeOption[] = [defaultHour - 1, defaultHour, defaultHour + 1]
    .filter((h) => h >= 0 && h <= 23)
    .map((h) => ({ hour: h, minute: 0, label: formatTime(h, 0) }))

  // If meal has a non-round time that isn't already a preset, insert it sorted
  if (mealMinute !== 0) {
    const mealKey = mealHour * 60 + mealMinute
    const alreadyPresent = presets.some((p) => p.hour === mealHour && p.minute === mealMinute)
    if (!alreadyPresent) {
      const mealOption: TimeOption = {
        hour: mealHour,
        minute: mealMinute,
        label: formatTime(mealHour, mealMinute),
      }
      const idx = presets.findIndex((p) => p.hour * 60 + p.minute > mealKey)
      if (idx === -1) presets.push(mealOption)
      else presets.splice(idx, 0, mealOption)
    }
  }

  return presets
}

const formatMealType = (type?: string): string =>
  type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Meal'

const findMealsForSlot = (meals: Meal[], slotName: string): Meal[] =>
  meals.filter((m) => m.meal_type === slotName.toLowerCase())

/** A clickable food item chip with popover for sensitivity mapping. */
function FoodItemChip({
  name,
  mappedSensitivities,
  sensitivityAreas,
  onToggle,
}: {
  name: string
  mappedSensitivities: string[]
  sensitivityAreas: string[]
  onToggle: (foodItem: string, area: string, checked: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [open])

  const hasMappings = mappedSensitivities.length > 0

  return (
    <span ref={ref} class={`food-item-chip ${hasMappings ? 'mapped' : ''}`} onClick={() => setOpen(!open)}>
      {name}
      {hasMappings && <span class="mapping-dot" />}
      {open && sensitivityAreas.length > 0 && (
        <div class="food-map-popover" onClick={(e) => e.stopPropagation()}>
          <div class="popover-title">Flags for "{name}"</div>
          {sensitivityAreas.map((area) => (
            <label key={area} class="popover-option">
              <input
                type="checkbox"
                checked={mappedSensitivities.includes(area)}
                onChange={(e) => onToggle(name, area, (e.target as HTMLInputElement).checked)}
              />
              {area}
            </label>
          ))}
        </div>
      )}
    </span>
  )
}

function MealDetails({
  meal,
  foodSensitivityMap,
  sensitivityAreas,
  onToggleFoodMapping,
}: {
  meal: Meal
  foodSensitivityMap: Record<string, string[]>
  sensitivityAreas: string[]
  onToggleFoodMapping: (foodItem: string, area: string, checked: boolean) => void
}) {
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
              mappedSensitivities={foodSensitivityMap[item.name] ?? []}
              sensitivityAreas={sensitivityAreas}
              onToggle={onToggleFoodMapping}
            />
          ))}
        </div>
      )}
      {hasCalories && <span class="meal-calories">{meal.calories} kcal</span>}
      {meal.notes && <div class="meal-notes">{meal.notes}</div>}
      {meal.source && meal.source !== 'manual' && <span class="meal-source">via {meal.source}</span>}
    </div>
  )
}

interface MealSlotRowProps {
  slot: MealSlot
  meals: Meal[]
  sensitivityAreas: string[]
  foodSensitivityMap: Record<string, string[]>
  onToggleSensitivity: (slot: MealSlot, area: string, existingMeal?: Meal) => void
  onToggleFoodMapping: (foodItem: string, area: string, checked: boolean) => void
  onChangeTime: (meal: Meal, hour: number, minute?: number) => void
  onCreateAndOpen: (slot: MealSlot) => void
  onDelete: (id: string) => void
  isDeletePending: boolean
  isSaving: boolean
}

function MealSlotRow({
  slot,
  meals: slotMeals,
  sensitivityAreas,
  foodSensitivityMap,
  onToggleSensitivity,
  onToggleFoodMapping,
  onChangeTime,
  onCreateAndOpen,
  onDelete,
  isDeletePending,
  isSaving,
}: MealSlotRowProps) {
  const primaryMeal = slotMeals[0]
  const explicit = primaryMeal?.sensitivities ?? []
  const derived = derivedSensitivities(primaryMeal, foodSensitivityMap)
  // Union of explicit + derived — checkbox shows checked if either
  const effectiveSensitivities = new Set([...explicit, ...derived])
  const mealH = primaryMeal ? primaryMeal.time.getHours() : slot.default_hour
  const mealM = primaryMeal ? primaryMeal.time.getMinutes() : 0

  // Build time options: preset hours + actual meal time if non-round
  const timeOptions = buildTimeOptions(slot.default_hour, mealH, mealM)

  return (
    <div class={`meal-slot-row ${primaryMeal ? 'has-meal' : ''}`}>
      <div class="slot-top">
        <span class="slot-name">{slot.name}</span>

        <div class="time-selector">
          {timeOptions.map((t) => (
            <button
              key={t.label}
              type="button"
              class={`time-btn ${mealH === t.hour && mealM === t.minute ? 'active' : ''}`}
              onClick={() => {
                if (primaryMeal) onChangeTime(primaryMeal, t.hour, t.minute)
              }}
              disabled={!primaryMeal && t.hour !== slot.default_hour}
              title={!primaryMeal ? 'Log a meal first to change the time' : `Set time to ${t.label}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {isSaving && <span class="saving-indicator" />}

        {primaryMeal ? (
          <a href={`/meals/${primaryMeal.id}`} class="meal-edit-link" title="Edit meal details">
            ...
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

      {slotMeals.map((meal) => (
        <MealDetails
          key={meal.id}
          meal={meal}
          foodSensitivityMap={foodSensitivityMap}
          sensitivityAreas={sensitivityAreas}
          onToggleFoodMapping={onToggleFoodMapping}
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

  return (
    <div class={`day-nutrient-summary${hasNutrients ? '' : ' empty'}`}>
      {!hasNutrients ? (
        <p class="no-nutrients">No nutrient data for this day.</p>
      ) : (
        <>
          <h3>Day Totals</h3>
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

function OtherMeals({
  meals,
  onDelete,
  isDeletePending,
  foodSensitivityMap,
  sensitivityAreas,
  onToggleFoodMapping,
}: {
  meals: Meal[]
  onDelete: (id: string) => void
  isDeletePending: boolean
  foodSensitivityMap: Record<string, string[]>
  sensitivityAreas: string[]
  onToggleFoodMapping: (foodItem: string, area: string, checked: boolean) => void
}) {
  if (meals.length === 0) return null
  return (
    <div class="other-meals">
      <h2>Other</h2>
      {meals.map((meal) => (
        <div key={meal.id} class="meal-slot-row has-meal">
          <div class="slot-top">
            <span class="slot-name">{formatMealType(meal.meal_type)}</span>
            <span class="meal-time">{format(meal.time, 'HH:mm')}</span>
            <ConfirmButton
              label="Delete"
              confirmMessage="Delete this meal?"
              onConfirm={() => onDelete(meal.id!)}
              isPending={isDeletePending}
              pendingLabel="Deleting..."
              buttonClass="btn-danger-small"
            />
          </div>
          <MealDetails
            meal={meal}
            foodSensitivityMap={foodSensitivityMap}
            sensitivityAreas={sensitivityAreas}
            onToggleFoodMapping={onToggleFoodMapping}
          />
        </div>
      ))}
    </div>
  )
}

const todayISO = () => formatISO(new Date(), { representation: 'date' })

/** Compute sensitivities derived from food items via the food-to-sensitivity mapping. */
const derivedSensitivities = (meal: Meal | undefined, foodMap: Record<string, string[]>): Set<string> => {
  const derived = new Set<string>()
  for (const item of meal?.food_items ?? []) {
    for (const area of foodMap[item.name] ?? []) derived.add(area)
  }
  return derived
}

const getOtherMeals = (meals: Meal[], slots: MealSlot[]): Meal[] => {
  const slotTypes = new Set(slots.map((s) => s.name.toLowerCase()))
  return meals
    .filter((m) => !slotTypes.has(m.meal_type ?? ''))
    .sort((a, b) => a.time.getTime() - b.time.getTime())
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

  const { data: settings } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const mealSlots = settings?.meal_slots?.length ? settings.meal_slots : DEFAULT_MEAL_SLOTS
  const sensitivityAreas = settings?.sensitivity_areas ?? []

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

  const otherMeals = getOtherMeals(meals ?? [], mealSlots)
  const foodSensitivityMap: Record<string, string[]> = settings?.food_sensitivity_map ?? {}
  const queryClient = useQueryClient()

  const foodMapMutation = useMutation({
    mutationFn: (newMap: Record<string, string[]>) => updateUserSettings({ food_sensitivity_map: newMap }),
    onSuccess: (result) => queryClient.setQueryData(['userSettings'], result),
    onError: () => queryClient.invalidateQueries({ queryKey: ['userSettings'] }),
  })

  const handleToggleFoodMapping = (foodItem: string, area: string, checked: boolean) => {
    const current = foodSensitivityMap[foodItem] ?? []
    const next = checked ? [...current, area] : current.filter((s) => s !== area)
    const cleaned = Object.fromEntries(
      Object.entries({ ...foodSensitivityMap, [foodItem]: next }).filter(([, v]) => v.length > 0),
    ) as Record<string, string[]>
    // Optimistic update — reflect immediately in UI
    queryClient.setQueryData(['userSettings'], (old: Record<string, unknown> | undefined) =>
      old ? { ...old, food_sensitivity_map: cleaned } : old,
    )
    foodMapMutation.mutate(cleaned)
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
          {mealSlots.map((slot) => (
            <MealSlotRow
              key={slot.name}
              slot={slot}
              meals={findMealsForSlot(meals ?? [], slot.name)}
              sensitivityAreas={sensitivityAreas}
              foodSensitivityMap={foodSensitivityMap}
              onToggleSensitivity={handleToggleSensitivity}
              onToggleFoodMapping={handleToggleFoodMapping}
              onChangeTime={handleChangeTime}
              onCreateAndOpen={handleCreateAndOpen}
              onDelete={(id) => deleteMutation.mutate(id)}
              isDeletePending={deleteMutation.isPending}
              isSaving={savingSlots.has(slot.name.toLowerCase())}
            />
          ))}
        </div>

        <OtherMeals
          meals={otherMeals}
          onDelete={(id) => deleteMutation.mutate(id)}
          isDeletePending={deleteMutation.isPending}
          foodSensitivityMap={foodSensitivityMap}
          sensitivityAreas={sensitivityAreas}
          onToggleFoodMapping={handleToggleFoodMapping}
        />

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

export function Meals() {
  const { query: urlQuery, route } = useLocation()

  const dateParam = new URLSearchParams(urlQuery).get('date')
  const dayKey = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayISO()

  const setDayKey = (date: string) => {
    if (date === todayISO()) route('/meals')
    else route(`/meals?date=${date}`)
  }

  return (
    <div class="meals-page">
      <div class="meals-header">
        <h1>Meals</h1>
        <DateNav value={dayKey} onChange={setDayKey} />
      </div>
      <MealsContent dayKey={dayKey} />
    </div>
  )
}
