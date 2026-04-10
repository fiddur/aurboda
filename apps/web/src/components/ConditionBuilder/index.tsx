/**
 * ConditionBuilder — editable list of AND-combined deduction rule conditions.
 */
import { useQuery } from '@tanstack/react-query'

import type { DeductionRuleCondition } from '../../state/api'

import { fetchActivityTypeDefinitions } from '../../state/api'
import './style.css'

const KIND_LABELS: Record<string, string> = {
  activity: 'Activity Type',
  activity_data: 'Activity Data Field',
  location: 'Location',
  screentime_category: 'Screentime Category',
  tag: 'Tag Name',
}

const KINDS: Array<DeductionRuleCondition['kind']> = [
  'activity',
  'tag',
  'screentime_category',
  'activity_data',
  'location',
]

const OPERATOR_LABELS: Record<string, string> = {
  eq: 'equals',
  exists: 'exists',
  neq: 'not equals',
  not_exists: 'not exists',
}

// ============================================================================
// Condition body renderers (extracted to reduce complexity)
// ============================================================================

function ActivityTypeSelect({
  condition,
  onChange,
  definitions,
}: {
  condition: DeductionRuleCondition
  onChange: (c: DeductionRuleCondition) => void
  definitions: { name: string; display_name: string }[]
}) {
  return (
    <select
      value={condition.activity_type ?? ''}
      onChange={(e) => onChange({ ...condition, activity_type: (e.target as HTMLSelectElement).value })}
      class="condition-field-select"
    >
      <option value="">-- select activity type --</option>
      {definitions.map((d) => (
        <option key={d.name} value={d.name}>
          {d.display_name} ({d.name})
        </option>
      ))}
    </select>
  )
}

function ActivityDataBody({
  condition,
  onChange,
  definitions,
}: {
  condition: DeductionRuleCondition
  onChange: (c: DeductionRuleCondition) => void
  definitions: { name: string; display_name: string }[]
}) {
  const needsValue = condition.operator === 'eq' || condition.operator === 'neq'
  return (
    <div class="condition-data-fields">
      <ActivityTypeSelect condition={condition} onChange={onChange} definitions={definitions} />
      <div class="condition-data-row">
        <input
          type="text"
          value={condition.field ?? ''}
          onInput={(e) => onChange({ ...condition, field: (e.target as HTMLInputElement).value })}
          placeholder="Field name"
          class="condition-field-input condition-field-narrow"
        />
        <select
          value={condition.operator ?? 'eq'}
          onChange={(e) =>
            onChange({
              ...condition,
              operator: (e.target as HTMLSelectElement).value as DeductionRuleCondition['operator'],
            })
          }
          class="condition-field-select condition-field-narrow"
        >
          {Object.entries(OPERATOR_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        {needsValue && (
          <input
            type="text"
            value={String(condition.value ?? '')}
            onInput={(e) => onChange({ ...condition, value: (e.target as HTMLInputElement).value })}
            placeholder="Value"
            class="condition-field-input condition-field-narrow"
          />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Single condition card
// ============================================================================

const KIND_DEFAULTS: Record<string, Partial<DeductionRuleCondition>> = {
  activity: { activity_type: '' },
  activity_data: { activity_type: '', field: '', operator: 'eq', value: '' },
  location: { location_name: '' },
  screentime_category: { category: [] },
  tag: { tag_name: '' },
}

function ConditionCard({
  condition,
  index,
  onChange,
  onRemove,
  canRemove,
}: {
  condition: DeductionRuleCondition
  index: number
  onChange: (index: number, updated: DeductionRuleCondition) => void
  onRemove: (index: number) => void
  canRemove: boolean
}) {
  const { data: definitions = [] } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 5 * 60_000,
  })

  const handleKindChange = (newKind: DeductionRuleCondition['kind']) => {
    onChange(index, { kind: newKind, ...KIND_DEFAULTS[newKind] } as DeductionRuleCondition)
  }

  const update = (c: DeductionRuleCondition) => onChange(index, c)

  return (
    <div class="condition-card">
      <div class="condition-card-header">
        <select
          value={condition.kind}
          onChange={(e) =>
            handleKindChange((e.target as HTMLSelectElement).value as DeductionRuleCondition['kind'])
          }
          class="condition-kind-select"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {canRemove && (
          <button
            type="button"
            class="condition-remove-btn"
            onClick={() => onRemove(index)}
            title="Remove condition"
          >
            &#x2715;
          </button>
        )}
      </div>

      <div class="condition-card-body">
        {condition.kind === 'activity' && (
          <ActivityTypeSelect condition={condition} onChange={update} definitions={definitions} />
        )}

        {condition.kind === 'tag' && (
          <input
            type="text"
            value={condition.tag_name ?? ''}
            onInput={(e) => update({ ...condition, tag_name: (e.target as HTMLInputElement).value })}
            placeholder="Tag name"
            class="condition-field-input"
          />
        )}

        {condition.kind === 'screentime_category' && (
          <input
            type="text"
            value={condition.category?.join(', ') ?? ''}
            onInput={(e) =>
              update({
                ...condition,
                category: (e.target as HTMLInputElement).value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="Category path (comma-separated, e.g. Work, Programming)"
            class="condition-field-input"
          />
        )}

        {condition.kind === 'activity_data' && (
          <ActivityDataBody condition={condition} onChange={update} definitions={definitions} />
        )}

        {condition.kind === 'location' && (
          <input
            type="text"
            value={condition.location_name ?? ''}
            onInput={(e) => update({ ...condition, location_name: (e.target as HTMLInputElement).value })}
            placeholder="Named location (e.g. Home, Office)"
            class="condition-field-input"
          />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Main component
// ============================================================================

export function ConditionBuilder({
  conditions,
  onChange,
}: {
  conditions: DeductionRuleCondition[]
  onChange: (conditions: DeductionRuleCondition[]) => void
}) {
  const handleChange = (index: number, updated: DeductionRuleCondition) => {
    const next = [...conditions]
    next[index] = updated
    onChange(next)
  }

  const handleRemove = (index: number) => {
    onChange(conditions.filter((_, i) => i !== index))
  }

  const handleAdd = () => {
    onChange([...conditions, { kind: 'activity' }])
  }

  return (
    <div class="condition-builder">
      {conditions.map((condition, i) => (
        <div key={i}>
          {i > 0 && <div class="condition-and">AND</div>}
          <ConditionCard
            condition={condition}
            index={i}
            onChange={handleChange}
            onRemove={handleRemove}
            canRemove={conditions.length > 1}
          />
        </div>
      ))}
      <button type="button" class="note-action-btn condition-add-btn" onClick={handleAdd}>
        Add Condition
      </button>
    </div>
  )
}
