import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { fetchUserSettings, updateUserSettings } from '../state/api'
import { auth } from '../state/auth'
import { type SaveStatus, SaveStatusIndicator } from './SaveStatusIndicator'
import { SettingsSection } from './SettingsSection'
import './MealPreferencesSettings.css'

interface MealSlot {
  name: string
  default_hour: number
}

export function MealPreferencesSettings() {
  const isLoggedIn = auth.value.token
  const queryClient = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const [newArea, setNewArea] = useState('')
  const [newSlotName, setNewSlotName] = useState('')
  const [newSlotHour, setNewSlotHour] = useState('12')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })

  const currentSlots: MealSlot[] = settings?.meal_slots ?? []
  const currentAreas: string[] = settings?.sensitivity_areas ?? []

  // Save immediately on any change
  const saveMutation = useMutation({
    mutationFn: updateUserSettings,
    onSuccess: (result) => {
      queryClient.setQueryData(['userSettings'], result)
      setSaveStatus({ status: 'saved', time: new Date() })
    },
    onError: (err) => {
      setSaveStatus({
        error: err instanceof Error ? err.message : 'Failed to save',
        status: 'error',
      })
    },
  })

  const saveAreas = (areas: string[]) => {
    setSaveStatus({ status: 'saving' })
    saveMutation.mutate({ sensitivity_areas: areas })
  }

  const saveSlots = (slots: MealSlot[]) => {
    setSaveStatus({ status: 'saving' })
    saveMutation.mutate({ meal_slots: slots })
  }

  // Sensitivity areas — save on each action
  const addArea = () => {
    const trimmed = newArea.trim()
    if (!trimmed || currentAreas.includes(trimmed)) return
    saveAreas([...currentAreas, trimmed])
    setNewArea('')
  }

  const removeArea = (area: string) => {
    saveAreas(currentAreas.filter((a) => a !== area))
  }

  // Meal slots — save on each action
  const addSlot = () => {
    const trimmed = newSlotName.trim()
    const hour = parseInt(newSlotHour, 10)
    if (!trimmed || isNaN(hour) || hour < 0 || hour > 23) return
    if (currentSlots.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) return
    saveSlots([...currentSlots, { name: trimmed, default_hour: hour }])
    setNewSlotName('')
    setNewSlotHour('12')
  }

  const removeSlot = (name: string) => {
    saveSlots(currentSlots.filter((s) => s.name !== name))
  }

  const updateSlotHour = (name: string, hour: number) => {
    if (isNaN(hour) || hour < 0 || hour > 23) return
    saveSlots(currentSlots.map((s) => (s.name === name ? { ...s, default_hour: hour } : s)))
  }

  return (
    <SettingsSection
      title="Meal Preferences"
      description="Configure meal slots and sensitivity areas for quick meal logging."
      isLoading={isLoading}
      headerExtra={<SaveStatusIndicator state={saveStatus} />}
    >
      {/* Meal Flags */}
      <div class="meal-pref-subsection">
        <h3>Meal Flags</h3>
        <p class="subsection-desc">Flags for categorizing meals (e.g., gluten, dairy, keto, cheat day).</p>

        <div class="area-list">
          {currentAreas.map((area) => (
            <div key={area} class="area-chip">
              <span>{area}</span>
              <button
                type="button"
                class="chip-remove"
                onClick={() => removeArea(area)}
                aria-label={`Remove ${area}`}
              >
                &times;
              </button>
            </div>
          ))}
        </div>

        <div class="add-row">
          <input
            type="text"
            placeholder="Add meal flag..."
            value={newArea}
            onInput={(e) => setNewArea((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && addArea()}
          />
          <button type="button" class="btn-secondary" onClick={addArea}>
            Add
          </button>
        </div>
      </div>

      {/* Meal Slots */}
      <div class="meal-pref-subsection">
        <h3>Meal Slots</h3>
        <p class="subsection-desc">Define your typical meal times for the quick-log UI.</p>

        <div class="slots-list">
          {currentSlots.map((slot) => (
            <div key={slot.name} class="slot-row">
              <span class="slot-label">{slot.name}</span>
              <label class="slot-hour-label">
                Default hour:
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={slot.default_hour}
                  onChange={(e) =>
                    updateSlotHour(slot.name, parseInt((e.target as HTMLInputElement).value, 10))
                  }
                  class="slot-hour-input"
                />
              </label>
              <button type="button" class="btn-danger-small" onClick={() => removeSlot(slot.name)}>
                Remove
              </button>
            </div>
          ))}
        </div>

        <div class="add-row">
          <input
            type="text"
            placeholder="Slot name (e.g., Breakfast)"
            value={newSlotName}
            onInput={(e) => setNewSlotName((e.target as HTMLInputElement).value)}
          />
          <input
            type="number"
            min="0"
            max="23"
            placeholder="Hour"
            value={newSlotHour}
            onInput={(e) => setNewSlotHour((e.target as HTMLInputElement).value)}
            class="slot-hour-input"
          />
          <button type="button" class="btn-secondary" onClick={addSlot}>
            Add
          </button>
        </div>
      </div>
    </SettingsSection>
  )
}
