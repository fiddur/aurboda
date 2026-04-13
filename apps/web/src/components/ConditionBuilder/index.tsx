/**
 * ConditionBuilder — editable list of AND-combined deduction rule conditions.
 */
import { useQuery } from '@tanstack/react-query'

import type { DataFilter, DeductionRuleCondition } from '../../state/api'

import { fetchActivityTypeDefinitions, fetchNamedLocations } from '../../state/api'
import { ActivityTypePicker } from '../ActivityTypePicker'
import './style.css'

const KIND_LABELS: Record<string, string> = {
  activity: 'Activity Type',
  activity_data: 'Activity Data Field',
  after_date: 'Since Date',
  location: 'Location',
  screentime_category: 'Screentime Category',
}

const KINDS: Array<DeductionRuleCondition['kind']> = [
  'activity',
  'screentime_category',
  'activity_data',
  'location',
  'after_date',
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
}: {
  condition: DeductionRuleCondition
  onChange: (c: DeductionRuleCondition) => void
}) {
  return (
    <ActivityTypePicker
      value={condition.activity_type ?? ''}
      onChange={(activity_type) => onChange({ ...condition, activity_type })}
      placeholder="Search activity types..."
    />
  )
}

function ActivityDataBody({
  condition,
  onChange,
}: {
  condition: DeductionRuleCondition
  onChange: (c: DeductionRuleCondition) => void
}) {
  const needsValue = condition.operator === 'eq' || condition.operator === 'neq'
  return (
    <div class="condition-data-fields">
      <ActivityTypeSelect condition={condition} onChange={onChange} />
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

function DataFiltersInline({
  filters,
  onChange,
  schemaFields,
}: {
  filters: DataFilter[]
  onChange: (filters: DataFilter[]) => void
  schemaFields: Array<{ name: string; label?: string }>
}) {
  const updateFilter = (i: number, patch: Partial<DataFilter>) => {
    onChange(filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }
  const removeFilter = (i: number) => onChange(filters.filter((_, idx) => idx !== i))
  const addFilter = () =>
    onChange([...filters, { field: schemaFields[0]?.name ?? '', operator: 'eq', value: '' }])

  return (
    <div class="condition-data-filters-inline">
      {filters.map((filter, i) => (
        <div class="condition-data-row" key={i}>
          <select
            value={filter.field}
            onChange={(e) => updateFilter(i, { field: (e.target as HTMLSelectElement).value })}
            class="condition-field-select condition-field-narrow"
          >
            {schemaFields.map((f) => (
              <option key={f.name} value={f.name}>
                {f.label ?? f.name}
              </option>
            ))}
          </select>
          <select
            value={filter.operator}
            onChange={(e) =>
              updateFilter(i, { operator: (e.target as HTMLSelectElement).value as DataFilter['operator'] })
            }
            class="condition-field-select condition-field-narrow"
          >
            {Object.entries(OPERATOR_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          {(filter.operator === 'eq' || filter.operator === 'neq') && (
            <input
              type="text"
              value={String(filter.value ?? '')}
              onInput={(e) => updateFilter(i, { value: (e.target as HTMLInputElement).value })}
              placeholder="Value"
              class="condition-field-input condition-field-narrow"
            />
          )}
          <button
            type="button"
            class="condition-remove-btn"
            onClick={() => removeFilter(i)}
            title="Remove filter"
          >
            &#x2715;
          </button>
        </div>
      ))}
      <button type="button" class="condition-add-filter-btn" onClick={addFilter}>
        + Where...
      </button>
    </div>
  )
}

// ============================================================================
// Single condition card
// ============================================================================

const KIND_DEFAULTS: Record<string, Partial<DeductionRuleCondition>> = {
  activity: { activity_type: '' },
  activity_data: { activity_type: '', field: '', operator: 'eq', value: '' },
  after_date: { date: new Date().toISOString().slice(0, 10) },
  location: { location_name: '' },
  screentime_category: { category: [] },
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

  const { data: namedLocations = [] } = useQuery({
    queryFn: fetchNamedLocations,
    queryKey: ['namedLocations'],
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
          <>
            <ActivityTypeSelect condition={condition} onChange={update} />
            {(() => {
              const typeDef = definitions.find((d) => d.name === condition.activity_type)
              const schemaFields = (
                typeDef as { data_schema?: { fields: Array<{ name: string; label?: string }> } }
              )?.data_schema?.fields
              if (!schemaFields?.length) return null
              return (
                <DataFiltersInline
                  filters={condition.data_filters ?? []}
                  onChange={(data_filters) => update({ ...condition, data_filters })}
                  schemaFields={schemaFields}
                />
              )
            })()}
          </>
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

        {condition.kind === 'activity_data' && <ActivityDataBody condition={condition} onChange={update} />}

        {condition.kind === 'location' && (
          <>
            <input
              type="text"
              list="named-locations-list"
              value={condition.location_name ?? ''}
              onInput={(e) => update({ ...condition, location_name: (e.target as HTMLInputElement).value })}
              placeholder="Start typing a location name..."
              class="condition-field-input"
            />
            <datalist id="named-locations-list">
              {namedLocations.map((loc) => (
                <option key={loc.name} value={loc.name} />
              ))}
            </datalist>
          </>
        )}

        {condition.kind === 'after_date' && (
          <input
            type="date"
            value={condition.date ?? ''}
            onInput={(e) => update({ ...condition, date: (e.target as HTMLInputElement).value })}
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
