import { metricUnits, validMetrics } from '@aurboda/api-spec'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'
import { type Goal, updateUserSettings } from '../state/api'

import './GoalsSettings.css'

interface GoalsSettingsProps {
  goals: Goal[]
}

// Duration unit descriptions for the info tooltip
const durationUnits = [
  { description: 'seconds', unit: 's' },
  { description: 'minutes', unit: 'm' },
  { description: 'hours', unit: 'h' },
  { description: 'days', unit: 'd' },
  { description: 'weeks', unit: 'w' },
  { description: 'months', unit: 'M' },
]

// Friendly names for metrics
const metricLabels: Record<string, string> = {
  calories_active: 'Active Calories',
  calories_basal: 'Basal Calories',
  calories_total: 'Total Calories',
  distance: 'Distance',
  floors_climbed: 'Floors Climbed',
  heart_rate: 'Heart Rate',
  hr_zone_0_sec: 'Zone 0 (Below Z1)',
  hr_zone_1_sec: 'Zone 1',
  hr_zone_2_sec: 'Zone 2',
  hr_zone_3_sec: 'Zone 3',
  hr_zone_4_sec: 'Zone 4',
  hr_zone_5_sec: 'Zone 5',
  hrv_rmssd: 'HRV (RMSSD)',
  readiness_score: 'Readiness Score',
  resilience_score: 'Resilience Score',
  resting_heart_rate: 'Resting HR',
  sleep_score: 'Sleep Score',
  spo2: 'SpO2',
  steps: 'Steps',
  vo2_max: 'VO2 Max',
  weight: 'Weight',
}

// Get display unit for a metric (e.g., 'sec' -> 'min' for HR zones)
const getDisplayUnit = (metric: string): string => {
  const unit = metricUnits[metric as keyof typeof metricUnits]
  if (unit === 'sec') return 'min'
  if (unit === 'count') return ''
  return unit ?? ''
}

// Convert value for display (seconds to minutes for HR zones)
const toDisplayValue = (metric: string, value: number | undefined): string => {
  if (value === undefined) return ''
  const unit = metricUnits[metric as keyof typeof metricUnits]
  if (unit === 'sec') return String(Math.round(value / 60))
  return String(value)
}

// Convert display value back to storage value
const fromDisplayValue = (metric: string, displayValue: string): number | undefined => {
  if (displayValue === '') return undefined
  const num = parseFloat(displayValue)
  if (isNaN(num)) return undefined
  const unit = metricUnits[metric as keyof typeof metricUnits]
  if (unit === 'sec') return num * 60
  return num
}

// Validate a goal - returns error message or null if valid
const validateGoal = (goal: Goal): string | null => {
  if (goal.min === undefined && goal.max === undefined) {
    return 'At least one of Min or Max is required'
  }
  if (goal.min !== undefined && goal.min <= 0) {
    return 'Min must be positive'
  }
  if (goal.max !== undefined && goal.max <= 0) {
    return 'Max must be positive'
  }
  if (goal.min !== undefined && goal.max !== undefined && goal.min > goal.max) {
    return 'Min cannot be greater than Max'
  }
  if (!/^\d+[smhdwM]$/.test(goal.window)) {
    return 'Invalid window format'
  }
  return null
}

// Check if all goals are valid
const allGoalsValid = (goals: Goal[]): boolean => {
  return goals.every((g) => validateGoal(g) === null)
}

// Local goal state for editing (allows invalid intermediate states)
interface LocalGoal extends Omit<Goal, 'min' | 'max' | 'window'> {
  min?: number
  max?: number
  window: string
  isNew?: boolean // Track if this is a newly added goal not yet saved
}

export function GoalsSettings({ goals }: GoalsSettingsProps) {
  const queryClient = useQueryClient()
  const [saveStatus, setSaveStatus] = useState<{ status: 'idle' | 'saving' | 'saved'; time?: Date }>({
    status: 'idle',
  })
  const [showDurationHelp, setShowDurationHelp] = useState(false)

  // Local state for goals being edited (includes unsaved new goals)
  const [localGoals, setLocalGoals] = useState<LocalGoal[]>(() => goals.map((g) => ({ ...g, isNew: false })))

  // Sync local state when props change (e.g., after successful save)
  const [prevGoals, setPrevGoals] = useState(goals)
  if (goals !== prevGoals) {
    setPrevGoals(goals)
    // Merge: keep local new goals, update saved goals from props
    setLocalGoals((local) => {
      const newGoals = local.filter((g) => g.isNew)
      const savedGoals = goals.map((g) => ({ ...g, isNew: false }))
      return [...savedGoals, ...newGoals]
    })
  }

  const mutation = useMutation({
    mutationFn: updateUserSettings,
    onError: () => {
      setSaveStatus({ status: 'idle' })
    },
    onMutate: () => {
      setSaveStatus({ status: 'saving' })
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['userSettings'], data)
      setSaveStatus({ status: 'saved', time: new Date() })
      // Mark all goals as saved
      setLocalGoals((local) => local.map((g) => ({ ...g, isNew: false })))
    },
  })

  const saveGoals = (goalsToSave: Goal[]) => {
    // Only save if all goals are valid
    if (!allGoalsValid(goalsToSave)) {
      return false
    }
    mutation.mutate({ goals: goalsToSave })
    return true
  }

  const handleFieldChange = (goalId: string, field: 'min' | 'max' | 'window', value: string) => {
    setLocalGoals((local) =>
      local.map((g) => {
        if (g.id !== goalId) return g

        if (field === 'window') {
          return { ...g, window: value }
        }

        const numValue = fromDisplayValue(g.metric, value)
        return { ...g, [field]: numValue }
      }),
    )
  }

  const handleFieldBlur = (goalId: string) => {
    const localGoal = localGoals.find((g) => g.id === goalId)
    if (!localGoal) return

    // Convert to Goal type for validation and saving
    const goalToValidate: Goal = {
      id: localGoal.id,
      max: localGoal.max,
      metric: localGoal.metric,
      min: localGoal.min,
      window: localGoal.window || '7d',
    }

    // Only save if valid
    if (validateGoal(goalToValidate) !== null) {
      return
    }

    // Build the full goals array to save
    const goalsToSave: Goal[] = localGoals
      .filter((g) => validateGoal({ ...g, window: g.window || '7d' } as Goal) === null)
      .map((g) => ({
        id: g.id,
        max: g.max,
        metric: g.metric,
        min: g.min,
        window: g.window || '7d',
      }))

    // Check if anything changed from the saved state
    const savedGoal = goals.find((g) => g.id === goalId)
    if (savedGoal && JSON.stringify(goalToValidate) === JSON.stringify(savedGoal)) {
      return
    }

    saveGoals(goalsToSave)
  }

  const handleMetricChange = (goalId: string, newMetric: string) => {
    setLocalGoals((local) =>
      local.map((g) => {
        if (g.id !== goalId) return g
        return { ...g, metric: newMetric as Goal['metric'] }
      }),
    )

    // Auto-save if goal is valid
    setTimeout(() => handleFieldBlur(goalId), 0)
  }

  const handleAddGoal = () => {
    const newGoal: LocalGoal = {
      id: crypto.randomUUID(),
      isNew: true,
      metric: 'steps',
      min: undefined, // Start empty so user fills it in
      window: '7d',
    }
    setLocalGoals((local) => [...local, newGoal])
  }

  const handleDeleteGoal = (goalId: string) => {
    const localGoal = localGoals.find((g) => g.id === goalId)

    // If it's a new unsaved goal, just remove from local state
    if (localGoal?.isNew) {
      setLocalGoals((local) => local.filter((g) => g.id !== goalId))
      return
    }

    // Otherwise, remove and save
    const updatedGoals = goals.filter((g) => g.id !== goalId)
    setLocalGoals((local) => local.filter((g) => g.id !== goalId))
    saveGoals(updatedGoals)
  }

  const handleMoveGoal = (goalId: string, direction: 'up' | 'down') => {
    setLocalGoals((local) => {
      const index = local.findIndex((g) => g.id === goalId)
      if (index === -1) return local
      if (direction === 'up' && index === 0) return local
      if (direction === 'down' && index === local.length - 1) return local

      const newIndex = direction === 'up' ? index - 1 : index + 1
      const newGoals = [...local]
      const [removed] = newGoals.splice(index, 1)
      newGoals.splice(newIndex, 0, removed)
      return newGoals
    })

    // Save the new order (only valid goals)
    setTimeout(() => {
      const goalsToSave: Goal[] = localGoals
        .filter((g) => !g.isNew && validateGoal({ ...g, window: g.window || '7d' } as Goal) === null)
        .map((g) => ({
          id: g.id,
          max: g.max,
          metric: g.metric,
          min: g.min,
          window: g.window || '7d',
        }))

      // Reorder based on current local state
      const reordered = localGoals
        .filter((g) => !g.isNew)
        .map((lg) => goalsToSave.find((g) => g.id === lg.id))
        .filter((g): g is Goal => g !== undefined)

      if (reordered.length > 0) {
        saveGoals(reordered)
      }
    }, 0)
  }

  const formatSavedTime = (time: Date): string => {
    const now = new Date()
    const diffSec = Math.floor((now.getTime() - time.getTime()) / 1000)
    if (diffSec < 5) return 'just now'
    if (diffSec < 60) return `${diffSec} seconds ago`
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`
    return time.toLocaleTimeString()
  }

  return (
    <section class="settings-section goals-section">
      <div class="section-header">
        <h2>Goals</h2>
        <button type="button" class="add-goal-button" onClick={handleAddGoal}>
          + Add Goal
        </button>
      </div>

      <p class="section-description">
        Set targets for metrics over a rolling time window. Goals are saved automatically when valid. Use
        arrows to reorder goals for the widget.
      </p>

      {saveStatus.status === 'saving' && <p class="save-status saving">Saving...</p>}
      {saveStatus.status === 'saved' && saveStatus.time && (
        <p class="save-status saved">Saved {formatSavedTime(saveStatus.time)}</p>
      )}
      {mutation.isError && (
        <p class="save-status error">
          Error: {mutation.error instanceof Error ? mutation.error.message : 'Failed to save'}
        </p>
      )}

      {localGoals.length === 0 ?
        <p class="no-goals">No goals set. Click "+ Add Goal" to create one.</p>
      : <div class="goals-list">
          {localGoals.map((goal, index) => {
            const validationError = validateGoal({
              ...goal,
              window: goal.window || '7d',
            } as Goal)
            const isInvalid = validationError !== null

            return (
              <div class={`goal-row ${isInvalid ? 'invalid' : ''} ${goal.isNew ? 'new' : ''}`} key={goal.id}>
                <div class="goal-reorder">
                  <button
                    type="button"
                    class="reorder-button"
                    onClick={() => handleMoveGoal(goal.id, 'up')}
                    disabled={index === 0}
                    aria-label="Move up"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    class="reorder-button"
                    onClick={() => handleMoveGoal(goal.id, 'down')}
                    disabled={index === localGoals.length - 1}
                    aria-label="Move down"
                  >
                    ▼
                  </button>
                </div>

                <div class="goal-field metric-field">
                  <label>Metric</label>
                  <select
                    value={goal.metric}
                    onChange={(e) => handleMetricChange(goal.id, (e.target as HTMLSelectElement).value)}
                  >
                    {validMetrics.map((metric) => (
                      <option key={metric} value={metric}>
                        {metricLabels[metric] ?? metric}
                      </option>
                    ))}
                  </select>
                </div>

                <div
                  class={`goal-field min-field ${goal.min === undefined && goal.max === undefined ? 'field-error' : ''}`}
                >
                  <label>Min</label>
                  <div class="input-with-unit">
                    <input
                      type="number"
                      value={toDisplayValue(goal.metric, goal.min)}
                      onInput={(e) => handleFieldChange(goal.id, 'min', (e.target as HTMLInputElement).value)}
                      onBlur={() => handleFieldBlur(goal.id)}
                      placeholder="-"
                    />
                    <span class="unit">{getDisplayUnit(goal.metric)}</span>
                  </div>
                </div>

                <div
                  class={`goal-field max-field ${goal.min === undefined && goal.max === undefined ? 'field-error' : ''}`}
                >
                  <label>Max</label>
                  <div class="input-with-unit">
                    <input
                      type="number"
                      value={toDisplayValue(goal.metric, goal.max)}
                      onInput={(e) => handleFieldChange(goal.id, 'max', (e.target as HTMLInputElement).value)}
                      onBlur={() => handleFieldBlur(goal.id)}
                      placeholder="-"
                    />
                    <span class="unit">{getDisplayUnit(goal.metric)}</span>
                  </div>
                </div>

                <div class="goal-field window-field">
                  <label>
                    Window{' '}
                    <button
                      type="button"
                      class="info-button"
                      onClick={() => setShowDurationHelp(!showDurationHelp)}
                      aria-label="Duration format help"
                    >
                      i
                    </button>
                  </label>
                  <input
                    type="text"
                    value={goal.window}
                    onInput={(e) =>
                      handleFieldChange(goal.id, 'window', (e.target as HTMLInputElement).value)
                    }
                    onBlur={() => handleFieldBlur(goal.id)}
                    placeholder="7d"
                  />
                </div>

                <button
                  type="button"
                  class="delete-goal-button"
                  onClick={() => handleDeleteGoal(goal.id)}
                  aria-label="Delete goal"
                >
                  ×
                </button>

                {isInvalid && <div class="validation-error">{validationError}</div>}
              </div>
            )
          })}
        </div>
      }

      {showDurationHelp && (
        <div class="duration-help">
          <p>Duration format: number + unit</p>
          <ul>
            {durationUnits.map(({ unit, description }) => (
              <li key={unit}>
                <code>{unit}</code> - {description}
              </li>
            ))}
          </ul>
          <p>Examples: 7d (7 days), 2w (2 weeks), 1M (1 month)</p>
        </div>
      )}
    </section>
  )
}
