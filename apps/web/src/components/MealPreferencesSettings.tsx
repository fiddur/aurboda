import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { fetchUserSettings, updateUserSettings } from '../state/api'
import { auth } from '../state/auth'
import { SaveCancelRow } from './SaveCancelRow'
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

  // Local state
  const [slots, setSlots] = useState<MealSlot[] | null>(null)
  const [areas, setAreas] = useState<string[] | null>(null)
  const [newArea, setNewArea] = useState('')
  const [newSlotName, setNewSlotName] = useState('')
  const [newSlotHour, setNewSlotHour] = useState('12')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })

  // Initialize from settings on first load
  const effectiveSlots = slots ?? settings?.meal_slots ?? []
  const effectiveAreas = areas ?? settings?.sensitivity_areas ?? []

  const hasChanges = slots !== null || areas !== null

  const saveMutation = useMutation({
    mutationFn: async () => {
      const params: Record<string, unknown> = {}
      if (slots !== null) params.meal_slots = slots
      if (areas !== null) params.sensitivity_areas = areas
      return updateUserSettings(params)
    },
    onSuccess: (result) => {
      queryClient.setQueryData(['userSettings'], result)
      setSaveStatus({ status: 'saved', time: new Date() })
      setSlots(null)
      setAreas(null)
    },
    onError: (err) => {
      setSaveStatus({
        error: err instanceof Error ? err.message : 'Failed to save',
        status: 'error',
      })
    },
  })

  const handleSave = () => {
    setSaveStatus({ status: 'saving' })
    saveMutation.mutate()
  }

  const handleCancel = () => {
    setSlots(null)
    setAreas(null)
    setSaveStatus({ status: 'idle' })
  }

  // Sensitivity areas
  const addArea = () => {
    const trimmed = newArea.trim()
    if (!trimmed || effectiveAreas.includes(trimmed)) return
    setAreas([...effectiveAreas, trimmed])
    setNewArea('')
  }

  const removeArea = (area: string) => {
    setAreas(effectiveAreas.filter((a) => a !== area))
  }

  // Meal slots
  const addSlot = () => {
    const trimmed = newSlotName.trim()
    const hour = parseInt(newSlotHour, 10)
    if (!trimmed || isNaN(hour) || hour < 0 || hour > 23) return
    if (effectiveSlots.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) return
    setSlots([...effectiveSlots, { name: trimmed, default_hour: hour }])
    setNewSlotName('')
    setNewSlotHour('12')
  }

  const removeSlot = (name: string) => {
    setSlots(effectiveSlots.filter((s) => s.name !== name))
  }

  const updateSlotHour = (name: string, hour: number) => {
    setSlots(effectiveSlots.map((s) => (s.name === name ? { ...s, default_hour: hour } : s)))
  }

  return (
    <SettingsSection
      title="Meal Preferences"
      description="Configure meal slots and sensitivity areas for quick meal logging."
      isLoading={isLoading}
      headerExtra={<SaveStatusIndicator status={saveStatus} />}
    >
      {/* Sensitivity Areas */}
      <div class="meal-pref-subsection">
        <h3>Sensitivity Areas</h3>
        <p class="subsection-desc">
          Food sensitivities you want to track (e.g., gluten, dairy, red meat, legumes).
        </p>

        <div class="area-list">
          {effectiveAreas.map((area) => (
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
            placeholder="Add sensitivity area..."
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
          {effectiveSlots.map((slot) => (
            <div key={slot.name} class="slot-row">
              <span class="slot-label">{slot.name}</span>
              <label class="slot-hour-label">
                Default hour:
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={slot.default_hour}
                  onInput={(e) =>
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

      {hasChanges && (
        <SaveCancelRow onSave={handleSave} onCancel={handleCancel} isPending={saveMutation.isPending} />
      )}
    </SettingsSection>
  )
}
