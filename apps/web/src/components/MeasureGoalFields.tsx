import {
  type ActivityMeasure,
  activityMeasureUnits,
  type MeasureGoal,
  type MeasureGoalAggregation,
} from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'

import { type ActivityTypeDefinition, fetchActivityFieldValues } from '../state/api'
import { measureFilter, measureOptions } from '../utils/measures'
import { setActivityType, setAggregation, setExerciseFilter, setMeasure } from './measureGoalEdits'

interface MeasureGoalFieldsProps {
  goal: MeasureGoal
  /** The activity types with list items to measure. */
  types: ActivityTypeDefinition[]
  onEdit: (edit: (goal: MeasureGoal) => MeasureGoal) => void
  onBoundChange: (field: 'min' | 'max', value: string) => void
  onBoundBlur: () => void
}

const selectValue = (e: Event): string => (e.target as HTMLSelectElement).value

export function MeasureGoalFields({
  goal,
  types,
  onEdit,
  onBoundChange,
  onBoundBlur,
}: MeasureGoalFieldsProps) {
  const filter = measureFilter(types.find((t) => t.name === goal.activity_type))
  const filterPath = filter?.path ?? ''
  const { data: fieldValues } = useQuery({
    enabled: Boolean(filterPath),
    queryFn: () => fetchActivityFieldValues(goal.activity_type, filterPath),
    queryKey: ['activity-field-values', goal.activity_type, filterPath],
    staleTime: 5 * 60 * 1000,
  })
  const unit = activityMeasureUnits[goal.measure]
  const boundError = goal.min === undefined && goal.max === undefined ? 'field-error' : ''
  const typeKnown = types.some((t) => t.name === goal.activity_type)
  const valueKnown = !goal.filter_value || fieldValues?.values.some((v) => v.value === goal.filter_value)

  return (
    <>
      <div class="goal-field measure-field">
        <label>Activity type</label>
        <select
          value={goal.activity_type}
          onChange={(e) => onEdit((g) => setActivityType(g, selectValue(e)))}
        >
          {!typeKnown && <option value={goal.activity_type}>{goal.activity_type}</option>}
          {types.map((t) => (
            <option key={t.name} value={t.name}>
              {t.display_name}
            </option>
          ))}
        </select>
      </div>

      {filter && (
        <div class="goal-field measure-field">
          <label>{filter.label}</label>
          <select
            value={goal.filter_value ?? ''}
            onChange={(e) => onEdit((g) => setExerciseFilter(g, filter.path, selectValue(e)))}
          >
            <option value="">All</option>
            {!valueKnown && <option value={goal.filter_value}>{goal.filter_value}</option>}
            {fieldValues?.values.map((v) => (
              <option key={v.value} value={v.value}>
                {v.value}
              </option>
            ))}
          </select>
        </div>
      )}

      <div class="goal-field measure-field">
        <label>Measure</label>
        <select
          value={goal.measure}
          onChange={(e) => onEdit((g) => setMeasure(g, selectValue(e) as ActivityMeasure))}
        >
          {measureOptions().map(({ label, value }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div class="goal-field measure-field aggregation-field">
        <label>Aggregation</label>
        <select
          value={goal.aggregation}
          onChange={(e) => onEdit((g) => setAggregation(g, selectValue(e) as MeasureGoalAggregation))}
        >
          <option value="max">Max</option>
          <option value="sum">Sum</option>
        </select>
      </div>

      <div class={`goal-field min-field ${boundError}`}>
        <label>Min</label>
        <div class="input-with-unit">
          <input
            type="number"
            step="any"
            value={goal.min ?? ''}
            onInput={(e) => onBoundChange('min', (e.target as HTMLInputElement).value)}
            onBlur={onBoundBlur}
            placeholder="-"
          />
          <span class="unit">{unit}</span>
        </div>
      </div>

      <div class={`goal-field max-field ${boundError}`}>
        <label>Max</label>
        <div class="input-with-unit">
          <input
            type="number"
            step="any"
            value={goal.max ?? ''}
            onInput={(e) => onBoundChange('max', (e.target as HTMLInputElement).value)}
            onBlur={onBoundBlur}
            placeholder="-"
          />
          <span class="unit">{unit}</span>
        </div>
      </div>
    </>
  )
}
