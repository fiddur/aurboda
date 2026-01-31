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

export function GoalsSettings({ goals }: GoalsSettingsProps) {
  const queryClient = useQueryClient()
  const [saveStatus, setSaveStatus] = useState<{ status: 'idle' | 'saving' | 'saved'; time?: Date }>({
    status: 'idle',
  })
  const [showDurationHelp, setShowDurationHelp] = useState(false)

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
    },
  })

  const saveGoals = (newGoals: Goal[]) => {
    mutation.mutate({ goals: newGoals })
  }

  const handleFieldBlur = (goalId: string, field: 'min' | 'max' | 'window', value: string) => {
    const goal = goals.find((g) => g.id === goalId)
    if (!goal) return

    const updatedGoals = goals.map((g) => {
      if (g.id !== goalId) return g

      if (field === 'window') {
        // Validate window format
        if (!/^\d+[smhdwM]$/.test(value)) return g
        return { ...g, window: value }
      }

      const numValue = fromDisplayValue(g.metric, value)
      return { ...g, [field]: numValue }
    })

    // Only save if something actually changed
    const updatedGoal = updatedGoals.find((g) => g.id === goalId)
    const originalGoal = goals.find((g) => g.id === goalId)
    if (JSON.stringify(updatedGoal) !== JSON.stringify(originalGoal)) {
      saveGoals(updatedGoals)
    }
  }

  const handleMetricChange = (goalId: string, newMetric: string) => {
    const updatedGoals = goals.map((g) => {
      if (g.id !== goalId) return g
      return { ...g, metric: newMetric as Goal['metric'] }
    })
    saveGoals(updatedGoals)
  }

  const handleAddGoal = () => {
    const newGoal: Goal = {
      id: crypto.randomUUID(),
      metric: 'steps',
      min: 10000,
      window: '7d',
    }
    saveGoals([...goals, newGoal])
  }

  const handleDeleteGoal = (goalId: string) => {
    const updatedGoals = goals.filter((g) => g.id !== goalId)
    saveGoals(updatedGoals)
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
        Set targets for metrics over a rolling time window. Goals are saved automatically when you change a
        field.
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

      {goals.length === 0 ?
        <p class="no-goals">No goals set. Click "+ Add Goal" to create one.</p>
      : <div class="goals-list">
          {goals.map((goal) => (
            <div class="goal-row" key={goal.id}>
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

              <div class="goal-field min-field">
                <label>Min</label>
                <div class="input-with-unit">
                  <input
                    type="number"
                    value={toDisplayValue(goal.metric, goal.min)}
                    onBlur={(e) => handleFieldBlur(goal.id, 'min', (e.target as HTMLInputElement).value)}
                    placeholder="-"
                  />
                  <span class="unit">{getDisplayUnit(goal.metric)}</span>
                </div>
              </div>

              <div class="goal-field max-field">
                <label>Max</label>
                <div class="input-with-unit">
                  <input
                    type="number"
                    value={toDisplayValue(goal.metric, goal.max)}
                    onBlur={(e) => handleFieldBlur(goal.id, 'max', (e.target as HTMLInputElement).value)}
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
                  onBlur={(e) => handleFieldBlur(goal.id, 'window', (e.target as HTMLInputElement).value)}
                  placeholder="7d"
                />
              </div>

              <button
                type="button"
                class="delete-goal-button"
                onClick={() => handleDeleteGoal(goal.id)}
                aria-label="Delete goal"
              >
                🗑
              </button>
            </div>
          ))}
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
