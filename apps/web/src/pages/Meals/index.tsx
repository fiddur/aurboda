import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, startOfDay, endOfDay, subDays } from 'date-fns'
import { useState } from 'preact/hooks'

import { ConfirmButton } from '../../components/ConfirmButton'
import { addMealApi, deleteMealApi, fetchMeals, fetchUserSettings, type Meal } from '../../state/api'
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

export function Meals() {
  const isLoggedIn = auth.value.token
  const queryClient = useQueryClient()

  // Date state for history
  const [historyDate, setHistoryDate] = useState(() => new Date())

  // Fetch user settings for meal slots and sensitivity areas
  const { data: settings } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const mealSlots: MealSlot[] =
    settings?.meal_slots && settings.meal_slots.length > 0 ? settings.meal_slots : DEFAULT_MEAL_SLOTS

  const sensitivityAreas: string[] = settings?.sensitivity_areas ?? []

  // Quick-log state per slot
  const [slotState, setSlotState] = useState<
    Record<string, { hour: number; sensitivities: Set<string>; name: string }>
  >({})

  const getSlotState = (slot: MealSlot) =>
    slotState[slot.name] ?? {
      hour: slot.default_hour,
      sensitivities: new Set<string>(),
      name: '',
    }

  const updateSlotState = (
    slotName: string,
    update: Partial<{ hour: number; sensitivities: Set<string>; name: string }>,
  ) => {
    setSlotState((prev) => ({
      ...prev,
      [slotName]: { ...getSlotState({ name: slotName, default_hour: 0 }), ...prev[slotName], ...update },
    }))
  }

  // Fetch meals for history
  const historyStart = startOfDay(historyDate)
  const historyEnd = endOfDay(historyDate)

  const { data: meals, isLoading: mealsLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () =>
      fetchMeals({
        start: historyStart.toISOString(),
        end: historyEnd.toISOString(),
      }),
    queryKey: ['meals', format(historyDate, 'yyyy-MM-dd')],
    staleTime: 30_000,
  })

  // Add meal mutation
  const addMutation = useMutation({
    mutationFn: addMealApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meals'] })
    },
  })

  // Delete meal mutation
  const deleteMutation = useMutation({
    mutationFn: deleteMealApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meals'] })
    },
  })

  const handleLog = (slot: MealSlot) => {
    const state = getSlotState(slot)
    const mealTime = new Date()
    mealTime.setHours(state.hour, 0, 0, 0)

    addMutation.mutate({
      meal_type: slot.name.toLowerCase(),
      name: state.name || undefined,
      sensitivities: [...state.sensitivities],
      source: 'manual',
      time: mealTime.toISOString(),
    })

    // Reset slot state after logging
    setSlotState((prev) => {
      const next = { ...prev }
      delete next[slot.name]
      return next
    })
  }

  const toggleSensitivity = (slotName: string, area: string) => {
    const state = getSlotState({ name: slotName, default_hour: 0 })
    const current = slotState[slotName]?.sensitivities ?? state.sensitivities
    const next = new Set(current)
    if (next.has(area)) {
      next.delete(area)
    } else {
      next.add(area)
    }
    updateSlotState(slotName, { sensitivities: next })
  }

  if (!isLoggedIn) {
    return (
      <div class="meals-page">
        <p>Please log in to use meal tracking.</p>
      </div>
    )
  }

  const sorted = [...(meals ?? [])].sort((a, b) => a.time.getTime() - b.time.getTime())

  return (
    <div class="meals-page">
      <h1>Meals</h1>

      {/* Quick-log section */}
      <section class="quick-log-section">
        <h2>Quick Log</h2>

        {sensitivityAreas.length === 0 && (
          <p class="config-hint">
            Configure your sensitivity areas and meal slots in <a href="/settings">Settings</a>.
          </p>
        )}

        {mealSlots.map((slot) => {
          const state = getSlotState(slot)
          const hours = [slot.default_hour - 1, slot.default_hour, slot.default_hour + 1].filter(
            (h) => h >= 0 && h <= 23,
          )

          return (
            <div key={slot.name} class="meal-slot-row">
              <span class="slot-name">{slot.name}</span>

              <div class="time-selector">
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    class={`time-btn ${state.hour === h ? 'active' : ''}`}
                    onClick={() => updateSlotState(slot.name, { hour: h })}
                  >
                    {formatHour(h)}
                  </button>
                ))}
              </div>

              <div class="sensitivity-checks">
                {sensitivityAreas.map((area) => (
                  <label key={area} class="sensitivity-label">
                    <input
                      type="checkbox"
                      checked={state.sensitivities.has(area)}
                      onChange={() => toggleSensitivity(slot.name, area)}
                    />
                    {area}
                  </label>
                ))}
              </div>

              <input
                type="text"
                class="meal-name-input"
                placeholder="Name (optional)"
                value={state.name}
                onInput={(e) => updateSlotState(slot.name, { name: (e.target as HTMLInputElement).value })}
              />

              <button
                type="button"
                class="btn-primary log-btn"
                onClick={() => handleLog(slot)}
                disabled={addMutation.isPending}
              >
                Log
              </button>
            </div>
          )
        })}

        {addMutation.isError && <p class="error-message">Failed to log meal. Please try again.</p>}
      </section>

      {/* Meal history section */}
      <section class="meal-history-section">
        <div class="history-header">
          <h2>History</h2>
          <div class="date-nav">
            <button type="button" class="btn-secondary" onClick={() => setHistoryDate((d) => subDays(d, 1))}>
              &larr;
            </button>
            <span class="history-date">{format(historyDate, 'EEE, MMM d')}</span>
            <button
              type="button"
              class="btn-secondary"
              onClick={() =>
                setHistoryDate((d) => {
                  const next = new Date(d)
                  next.setDate(next.getDate() + 1)
                  return next > new Date() ? d : next
                })
              }
              disabled={format(historyDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')}
            >
              &rarr;
            </button>
          </div>
        </div>

        {mealsLoading ? (
          <p class="loading">Loading meals...</p>
        ) : sorted.length === 0 ? (
          <p class="no-data">No meals logged for this day.</p>
        ) : (
          <div class="meals-list">
            {sorted.map((meal: Meal) => (
              <div key={meal.id} class="meal-card">
                <div class="meal-card-header">
                  <span class="meal-type">{formatMealType(meal.meal_type)}</span>
                  <span class="meal-time">{format(meal.time, 'HH:mm')}</span>
                </div>
                {meal.name && <div class="meal-name">{meal.name}</div>}
                {meal.sensitivities && meal.sensitivities.length > 0 && (
                  <div class="meal-sensitivities">
                    {meal.sensitivities.map((s) => (
                      <span key={s} class="sensitivity-chip">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                {meal.notes && <div class="meal-notes">{meal.notes}</div>}
                <div class="meal-card-actions">
                  <ConfirmButton
                    label="Delete"
                    confirmMessage="Delete this meal?"
                    onConfirm={() => deleteMutation.mutate(meal.id!)}
                    isPending={deleteMutation.isPending}
                    pendingLabel="Deleting..."
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
