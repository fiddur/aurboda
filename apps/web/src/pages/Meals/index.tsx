import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfDay, format, formatISO, startOfDay } from 'date-fns'
import { useLocation } from 'preact-iso'
import { useCallback, useState } from 'preact/hooks'

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

const formatHour = (hour: number): string => `${hour}:00`

const formatMealType = (type?: string): string =>
  type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Meal'

const findMealsForSlot = (meals: Meal[], slotName: string): Meal[] =>
  meals.filter((m) => m.meal_type === slotName.toLowerCase())

function MealDetails({ meal }: { meal: Meal }) {
  const hasFoodItems = meal.food_items && meal.food_items.length > 0
  const hasSensitivities = meal.sensitivities && meal.sensitivities.length > 0
  const hasCalories = meal.calories !== undefined

  if (!meal.name && !hasFoodItems && !hasSensitivities && !meal.notes && !hasCalories) return null

  return (
    <div class="meal-details">
      {meal.name && <div class="meal-name">{meal.name}</div>}
      {hasFoodItems && (
        <div class="food-items">
          {meal.food_items!.map((item, i) => (
            <span key={i} class="food-item-chip">
              {item.name}
            </span>
          ))}
        </div>
      )}
      {hasSensitivities && (
        <div class="meal-sensitivities">
          {meal.sensitivities!.map((s) => (
            <span key={s} class="sensitivity-chip">
              {s}
            </span>
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
  onToggleSensitivity: (slot: MealSlot, area: string, existingMeal?: Meal) => void
  onChangeHour: (meal: Meal, hour: number) => void
  onDelete: (id: string) => void
  isDeletePending: boolean
  isSaving: boolean
}

function MealSlotRow({
  slot,
  meals: slotMeals,
  sensitivityAreas,
  onToggleSensitivity,
  onChangeHour,
  onDelete,
  isDeletePending,
  isSaving,
}: MealSlotRowProps) {
  const primaryMeal = slotMeals[0]
  const sensitivities = primaryMeal?.sensitivities ?? []
  const mealHour = primaryMeal ? primaryMeal.time.getHours() : slot.default_hour
  const hours = [slot.default_hour - 1, slot.default_hour, slot.default_hour + 1].filter(
    (h) => h >= 0 && h <= 23,
  )

  return (
    <div class={`meal-slot-row ${primaryMeal ? 'has-meal' : ''}`}>
      <div class="slot-top">
        <span class="slot-name">{slot.name}</span>

        <div class="time-selector">
          {hours.map((h) => (
            <button
              key={h}
              type="button"
              class={`time-btn ${mealHour === h ? 'active' : ''}`}
              onClick={() => {
                if (primaryMeal) onChangeHour(primaryMeal, h)
              }}
              disabled={!primaryMeal && h !== slot.default_hour}
              title={!primaryMeal ? 'Log a meal first to change the time' : `Set time to ${formatHour(h)}`}
            >
              {formatHour(h)}
            </button>
          ))}
        </div>

        {isSaving && <span class="saving-indicator" />}

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
          {sensitivityAreas.map((area) => (
            <label key={area} class="sensitivity-label">
              <input
                type="checkbox"
                checked={sensitivities.includes(area)}
                onChange={() => onToggleSensitivity(slot, area, primaryMeal)}
              />
              {area}
            </label>
          ))}
        </div>
      )}

      {slotMeals.map((meal) => (
        <MealDetails key={meal.id} meal={meal} />
      ))}
    </div>
  )
}

function OtherMeals({
  meals,
  onDelete,
  isDeletePending,
}: {
  meals: Meal[]
  onDelete: (id: string) => void
  isDeletePending: boolean
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
          <MealDetails meal={meal} />
        </div>
      ))}
    </div>
  )
}

const todayISO = () => formatISO(new Date(), { representation: 'date' })

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

  const handleChangeHour = (meal: Meal, hour: number) => {
    const newTime = new Date(meal.time)
    newTime.setHours(hour, 0, 0, 0)
    optimisticUpdate((old) => old.map((m) => (m.id === meal.id ? { ...m, time: newTime } : m)))
    if (meal.meal_type) markSlotSaving(meal.meal_type, true)
    updateMutation.mutate({ id: meal.id!, time: newTime.toISOString() })
  }

  return {
    savingSlots,
    handleToggleSensitivity,
    handleChangeHour,
    upsertMutation,
    updateMutation,
    deleteMutation,
    toggleCompletedMutation,
  }
}

function MealsContent({ dayKey }: { dayKey: string }) {
  const isLoggedIn = auth.value.token

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
    queryFn: () => fetchMeals({ start: dayStart.toISOString(), end: dayEnd.toISOString() }),
    queryKey: mealsQueryKey,
    staleTime: 30_000,
  })

  const meals = mealsResult?.meals
  const isDayCompleted = mealsResult?.log_completed ?? false

  const {
    savingSlots,
    handleToggleSensitivity,
    handleChangeHour,
    upsertMutation,
    updateMutation,
    deleteMutation,
    toggleCompletedMutation,
  } = useMealMutations(mealsQueryKey, meals)

  const otherMeals = getOtherMeals(meals ?? [], mealSlots)

  if (!isLoggedIn) return <p>Please log in to use meal tracking.</p>
  if (isLoading) return <p class="loading">Loading...</p>

  const isToday = dayKey === todayISO()

  return (
    <>
      {sensitivityAreas.length === 0 && (
        <p class="config-hint">
          Configure your sensitivity areas and meal slots in <a href="/settings">Settings</a>.
        </p>
      )}

      <div class="meal-slots">
        {mealSlots.map((slot) => (
          <MealSlotRow
            key={slot.name}
            slot={slot}
            meals={findMealsForSlot(meals ?? [], slot.name)}
            sensitivityAreas={sensitivityAreas}
            onToggleSensitivity={handleToggleSensitivity}
            onChangeHour={handleChangeHour}
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
    </>
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
