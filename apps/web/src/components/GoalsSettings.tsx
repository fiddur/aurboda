import { type MeasureGoal, measureGoalTitle, metricUnits, validMetrics } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { fetchActivityTypeDefinitions, type Goal, updateUserSettings } from '../state/api'
import { measurableTypes } from '../utils/measures'
import { metricLabels } from '../utils/metricLabels'
import { newId } from '../utils/uuid'
import { newMeasureGoal } from './measureGoalEdits'
import { MeasureGoalFields } from './MeasureGoalFields'
import { type SaveStatus, SaveStatusIndicator } from './SaveStatusIndicator'
import { SettingsSection } from './SettingsSection'
import './GoalsSettings.css'

interface GoalsSettingsProps {
  goals: Goal[]
  /** A new goal to start editing, such as one prefilled from a chart; left out once it is saved. */
  initialGoal?: Goal
}

const durationUnits = [
  { description: 'seconds', unit: 's' },
  { description: 'minutes', unit: 'm' },
  { description: 'hours', unit: 'h' },
  { description: 'days', unit: 'd' },
  { description: 'weeks', unit: 'w' },
  { description: 'months', unit: 'M' },
]

const getDisplayUnit = (metric: string): string => {
  const unit = metricUnits[metric as keyof typeof metricUnits]
  if (unit === 'sec') return 'min'
  if (unit === 'count') return ''
  return unit ?? ''
}

const toDisplayValue = (metric: string, value: number | undefined): string => {
  if (value === undefined) return ''
  const unit = metricUnits[metric as keyof typeof metricUnits]
  if (unit === 'sec') return String(Math.round(value / 60))
  return String(value)
}

const fromDisplayValue = (metric: string, displayValue: string): number | undefined => {
  if (displayValue === '') return undefined
  const num = parseFloat(displayValue)
  if (isNaN(num)) return undefined
  const unit = metricUnits[metric as keyof typeof metricUnits]
  if (unit === 'sec') return num * 60
  return num
}

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
  if (goal.goal_type !== 'trend' && !/^\d+[smhdwM]$/.test(goal.window)) {
    return 'Invalid window format'
  }
  return null
}

const allGoalsValid = (goals: Goal[]): boolean => {
  return goals.every((g) => validateGoal(g) === null)
}

// Local goal state for editing (allows invalid intermediate states)
type LocalGoal = Goal & {
  isNew?: boolean // Track if this is a newly added goal not yet saved
}

const stripIsNew = ({ isNew: _, ...goal }: LocalGoal): Goal => goal

export function GoalsSettings({ goals, initialGoal }: GoalsSettingsProps) {
  const queryClient = useQueryClient()
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [showDurationHelp, setShowDurationHelp] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const [localGoals, setLocalGoals] = useState<LocalGoal[]>(() => [
    ...goals.map((g) => ({ ...g, isNew: false })),
    ...(initialGoal && !goals.some((g) => g.id === initialGoal.id) ? [{ ...initialGoal, isNew: true }] : []),
  ])

  const { data: definitions = [] } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 5 * 60 * 1000,
  })
  const measurable = measurableTypes(definitions)

  // Sync local state when props change (e.g., after successful save)
  const [prevGoals, setPrevGoals] = useState(goals)
  if (goals !== prevGoals) {
    setPrevGoals(goals)
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
      void queryClient.invalidateQueries({ queryKey: ['userSettings'] })
      void queryClient.invalidateQueries({ queryKey: ['goalsProgress'] })
      setSaveStatus({ status: 'saved', time: new Date() })
      setLocalGoals((local) => local.map((g) => ({ ...g, isNew: false })))
    },
  })

  const saveGoals = (goalsToSave: Goal[]) => {
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

        const numValue =
          g.goal_type === 'metric'
            ? fromDisplayValue(g.metric, value)
            : value === ''
              ? undefined
              : parseFloat(value)
        return { ...g, [field]: numValue }
      }),
    )
  }

  /** Saves `list` when the goal is valid and changed; pass the list a change just produced, as state lags. */
  const handleFieldBlur = (goalId: string, list: LocalGoal[] = localGoals) => {
    const localGoal = list.find((g) => g.id === goalId)
    if (!localGoal) return

    const goalToValidate = stripIsNew(localGoal)
    if (validateGoal(goalToValidate) !== null) {
      return
    }

    const goalsToSave: Goal[] = list.filter((g) => validateGoal(g) === null).map(stripIsNew)

    const savedGoal = goals.find((g) => g.id === goalId)
    if (savedGoal && JSON.stringify(goalToValidate) === JSON.stringify(savedGoal)) {
      return
    }

    saveGoals(goalsToSave)
  }

  const commitGoals = (goalId: string, next: LocalGoal[]) => {
    setLocalGoals(next)
    handleFieldBlur(goalId, next)
  }

  const handleMetricChange = (goalId: string, newMetric: string) =>
    commitGoals(
      goalId,
      localGoals.map((g) =>
        g.id === goalId && g.goal_type === 'metric' ? { ...g, metric: newMetric as typeof g.metric } : g,
      ),
    )

  const handleMeasureEdit = (goalId: string, edit: (goal: MeasureGoal) => MeasureGoal) =>
    commitGoals(
      goalId,
      localGoals.map((g) =>
        g.id === goalId && g.goal_type === 'measure' ? { ...edit(g), isNew: g.isNew } : g,
      ),
    )

  const handleAddMeasureGoal = () => {
    const goal = newMeasureGoal(measurable, newId())
    if (goal) setLocalGoals((local) => [...local, { ...goal, isNew: true }])
  }

  const handleAddGoal = () => {
    const newGoal: LocalGoal = {
      goal_type: 'metric',
      id: newId(),
      isNew: true,
      metric: 'steps',
      min: undefined, // Start empty so user fills it in
      window: '7d',
    }
    setLocalGoals((local) => [...local, newGoal])
  }

  const handleDeleteGoal = (goalId: string) => {
    const localGoal = localGoals.find((g) => g.id === goalId)

    if (localGoal?.isNew) {
      setLocalGoals((local) => local.filter((g) => g.id !== goalId))
      return
    }

    const updatedGoals = goals.filter((g) => g.id !== goalId)
    setLocalGoals((local) => local.filter((g) => g.id !== goalId))
    saveGoals(updatedGoals)
  }

  const reorderGoals = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return

    setLocalGoals((local) => {
      const newGoals = [...local]
      const [removed] = newGoals.splice(fromIndex, 1)
      newGoals.splice(toIndex, 0, removed)

      const goalsToSave: Goal[] = newGoals.filter((g) => !g.isNew && validateGoal(g) === null).map(stripIsNew)

      if (goalsToSave.length > 0) {
        // Use setTimeout to avoid calling mutation during render
        setTimeout(() => saveGoals(goalsToSave), 0)
      }

      return newGoals
    })
  }

  const handleDragStart = (e: DragEvent, goalId: string) => {
    setDraggedId(goalId)
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', goalId)
    }
  }

  const handleDragOver = (e: DragEvent, goalId: string) => {
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move'
    }
    if (draggedId && goalId !== draggedId) {
      setDragOverId(goalId)
    }
  }

  const handleDragLeave = () => {
    setDragOverId(null)
  }

  const handleDrop = (e: DragEvent, targetId: string) => {
    e.preventDefault()
    setDragOverId(null)

    if (!draggedId || draggedId === targetId) {
      setDraggedId(null)
      return
    }

    const fromIndex = localGoals.findIndex((g) => g.id === draggedId)
    const toIndex = localGoals.findIndex((g) => g.id === targetId)

    if (fromIndex !== -1 && toIndex !== -1) {
      reorderGoals(fromIndex, toIndex)
    }

    setDraggedId(null)
  }

  const handleDragEnd = () => {
    setDraggedId(null)
    setDragOverId(null)
  }

  return (
    <SettingsSection
      title="Goals"
      class="goals-section"
      description="Set targets for metrics, or for measures of activities such as an exercise's best e1RM, over a rolling time window. Goals are saved automatically when valid. Drag goals to reorder them for the widget."
      headerExtra={
        <div class="add-goal-buttons">
          <button type="button" class="add-goal-button" onClick={handleAddGoal}>
            + Metric goal
          </button>
          <button
            type="button"
            class="add-goal-button"
            onClick={handleAddMeasureGoal}
            disabled={measurable.length === 0}
            title={measurable.length === 0 ? 'No activity type has list items to measure' : undefined}
          >
            + Measure goal
          </button>
        </div>
      }
      isEmpty={localGoals.length === 0}
      emptyMessage={'No goals set. Click "+ Metric goal" or "+ Measure goal" to create one.'}
    >
      <SaveStatusIndicator state={saveStatus} />
      {mutation.isError && (
        <p class="save-status error">
          Error: {mutation.error instanceof Error ? mutation.error.message : 'Failed to save'}
        </p>
      )}

      <div class="goals-list">
        {/* eslint-disable-next-line complexity -- handles the metric, trend and measure goal forms */}
        {localGoals.map((goal) => {
          const validationError = validateGoal(goal)
          const isInvalid = validationError !== null

          return (
            <div
              class={`goal-row ${isInvalid ? 'invalid' : ''} ${goal.isNew ? 'new' : ''} ${draggedId === goal.id ? 'dragging' : ''} ${dragOverId === goal.id ? 'drag-over' : ''}`}
              key={goal.id}
              draggable={!goal.isNew}
              onDragStart={(e) => handleDragStart(e, goal.id)}
              onDragOver={(e) => handleDragOver(e, goal.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, goal.id)}
              onDragEnd={handleDragEnd}
            >
              <div class="drag-handle" title="Drag to reorder">
                ⋮⋮
              </div>

              {goal.goal_type === 'measure' ? (
                <MeasureGoalFields
                  goal={goal}
                  types={measurable}
                  onEdit={(edit) => handleMeasureEdit(goal.id, edit)}
                  onBoundChange={(field, value) => handleFieldChange(goal.id, field, value)}
                  onBoundBlur={() => handleFieldBlur(goal.id)}
                />
              ) : goal.goal_type === 'trend' ? (
                <>
                  <div class="goal-field metric-field">
                    <label>Trend</label>
                    <span class="trend-label">
                      {goal.measure
                        ? `${measureGoalTitle(goal.measure, goal.filter_value, goal.pattern)} (${goal.half_life_days}-day half-life)`
                        : `${goal.pattern} (${goal.display_period})`}
                    </span>
                  </div>

                  <div
                    class={`goal-field min-field ${goal.min === undefined && goal.max === undefined ? 'field-error' : ''}`}
                  >
                    <label>Min</label>
                    <input
                      type="number"
                      step="0.1"
                      value={goal.min ?? ''}
                      onInput={(e) => handleFieldChange(goal.id, 'min', (e.target as HTMLInputElement).value)}
                      onBlur={() => handleFieldBlur(goal.id)}
                      placeholder="-"
                    />
                  </div>

                  <div
                    class={`goal-field max-field ${goal.min === undefined && goal.max === undefined ? 'field-error' : ''}`}
                  >
                    <label>Max</label>
                    <input
                      type="number"
                      step="0.1"
                      value={goal.max ?? ''}
                      onInput={(e) => handleFieldChange(goal.id, 'max', (e.target as HTMLInputElement).value)}
                      onBlur={() => handleFieldBlur(goal.id)}
                      placeholder="-"
                    />
                  </div>
                </>
              ) : (
                <>
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
                        onInput={(e) =>
                          handleFieldChange(goal.id, 'min', (e.target as HTMLInputElement).value)
                        }
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
                        onInput={(e) =>
                          handleFieldChange(goal.id, 'max', (e.target as HTMLInputElement).value)
                        }
                        onBlur={() => handleFieldBlur(goal.id)}
                        placeholder="-"
                      />
                      <span class="unit">{getDisplayUnit(goal.metric)}</span>
                    </div>
                  </div>
                </>
              )}

              {goal.goal_type !== 'trend' && (
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
                    placeholder={goal.goal_type === 'measure' ? '30d' : '7d'}
                  />
                </div>
              )}

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
    </SettingsSection>
  )
}
