import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfDay, format, startOfDay, subDays } from 'date-fns'
import { useState } from 'preact/hooks'

import { ConfirmButton } from '../../components/ConfirmButton'
import {
  addMealApi,
  deleteMealApi,
  fetchMeals,
  fetchUserSettings,
  type Meal,
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

/** Find the existing meal for a slot on the selected day. */
const findMealForSlot = (meals: Meal[], slotName: string): Meal | undefined =>
  meals.find((m) => m.meal_type === slotName.toLowerCase())

export function Meals() {
  const isLoggedIn = auth.value.token
  const queryClient = useQueryClient()

  const [selectedDate, setSelectedDate] = useState(() => new Date())

  const { data: settings } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const mealSlots: MealSlot[] =
    settings?.meal_slots && settings.meal_slots.length > 0 ? settings.meal_slots : DEFAULT_MEAL_SLOTS
  const sensitivityAreas: string[] = settings?.sensitivity_areas ?? []

  // Fetch meals for the selected day
  const dayStart = startOfDay(selectedDate)
  const dayEnd = endOfDay(selectedDate)
  const dayKey = format(selectedDate, 'yyyy-MM-dd')

  const { data: meals, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchMeals({ start: dayStart.toISOString(), end: dayEnd.toISOString() }),
    queryKey: ['meals', dayKey],
    staleTime: 30_000,
  })

  const invalidateMeals = () => queryClient.invalidateQueries({ queryKey: ['meals'] })

  // Create a new meal for a slot
  const addMutation = useMutation({ mutationFn: addMealApi, onSuccess: invalidateMeals })

  // Update an existing meal
  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Parameters<typeof updateMealApi>[1]) =>
      updateMealApi(id, body),
    onSuccess: invalidateMeals,
  })

  // Delete a meal
  const deleteMutation = useMutation({ mutationFn: deleteMealApi, onSuccess: invalidateMeals })

  /** Toggle a sensitivity for a slot. Creates the meal if it doesn't exist yet. */
  const handleToggleSensitivity = (slot: MealSlot, area: string) => {
    const existing = findMealForSlot(meals ?? [], slot.name)

    if (existing) {
      // Update existing meal
      const current = existing.sensitivities ?? []
      const next = current.includes(area) ? current.filter((s) => s !== area) : [...current, area]
      updateMutation.mutate({ id: existing.id!, sensitivities: next })
    } else {
      // Create new meal at default hour
      const mealTime = new Date(selectedDate)
      mealTime.setHours(slot.default_hour, 0, 0, 0)
      addMutation.mutate({
        meal_type: slot.name.toLowerCase(),
        sensitivities: [area],
        source: 'manual',
        time: mealTime.toISOString(),
      })
    }
  }

  /** Change the hour for an existing meal. */
  const handleChangeHour = (meal: Meal, hour: number) => {
    const newTime = new Date(meal.time)
    newTime.setHours(hour, 0, 0, 0)
    updateMutation.mutate({ id: meal.id!, time: newTime.toISOString() })
  }

  /** Navigate to previous day. */
  const goBack = () => setSelectedDate((d) => subDays(d, 1))

  /** Navigate to next day (not beyond today). */
  const goForward = () =>
    setSelectedDate((d) => {
      const next = new Date(d)
      next.setDate(next.getDate() + 1)
      return next > new Date() ? d : next
    })

  const isToday = dayKey === format(new Date(), 'yyyy-MM-dd')

  if (!isLoggedIn) {
    return (
      <div class="meals-page">
        <p>Please log in to use meal tracking.</p>
      </div>
    )
  }

  return (
    <div class="meals-page">
      <div class="meals-header">
        <h1>Meals</h1>
        <div class="date-nav">
          <button type="button" class="btn-secondary" onClick={goBack}>
            &larr;
          </button>
          <span class="history-date">{isToday ? 'Today' : format(selectedDate, 'EEE, MMM d')}</span>
          <button type="button" class="btn-secondary" onClick={goForward} disabled={isToday}>
            &rarr;
          </button>
        </div>
      </div>

      {sensitivityAreas.length === 0 && (
        <p class="config-hint">
          Configure your sensitivity areas and meal slots in <a href="/settings">Settings</a>.
        </p>
      )}

      {isLoading ? (
        <p class="loading">Loading...</p>
      ) : (
        <div class="meal-slots">
          {mealSlots.map((slot) => {
            const meal = findMealForSlot(meals ?? [], slot.name)
            const sensitivities = meal?.sensitivities ?? []
            const mealHour = meal ? meal.time.getHours() : slot.default_hour
            const hours = [slot.default_hour - 1, slot.default_hour, slot.default_hour + 1].filter(
              (h) => h >= 0 && h <= 23,
            )

            return (
              <div key={slot.name} class={`meal-slot-row ${meal ? 'has-meal' : ''}`}>
                <div class="slot-top">
                  <span class="slot-name">{slot.name}</span>

                  <div class="time-selector">
                    {hours.map((h) => (
                      <button
                        key={h}
                        type="button"
                        class={`time-btn ${mealHour === h ? 'active' : ''}`}
                        onClick={() => {
                          if (meal) {
                            handleChangeHour(meal, h)
                          }
                          // If no meal yet, the hour will be used when first sensitivity is checked
                        }}
                        disabled={!meal && h !== slot.default_hour}
                        title={!meal ? 'Log a meal first to change the time' : `Set time to ${formatHour(h)}`}
                      >
                        {formatHour(h)}
                      </button>
                    ))}
                  </div>

                  {meal && (
                    <ConfirmButton
                      label="Delete"
                      confirmMessage="Delete this meal?"
                      onConfirm={() => deleteMutation.mutate(meal.id!)}
                      isPending={deleteMutation.isPending}
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
                          onChange={() => handleToggleSensitivity(slot, area)}
                        />
                        {area}
                      </label>
                    ))}
                  </div>
                )}

                {meal?.name && <div class="meal-name">{meal.name}</div>}
              </div>
            )
          })}
        </div>
      )}

      {(addMutation.isError || updateMutation.isError) && (
        <p class="error-message">Something went wrong. Please try again.</p>
      )}
    </div>
  )
}
