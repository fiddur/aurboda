/**
 * ConditionBuilder — editable list of AND-combined deduction rule conditions.
 */
import { useQuery } from '@tanstack/react-query'

import type { DeductionRuleCondition } from '../../state/api'

import { fetchActivityTypeDefinitions } from '../../state/api'
import './style.css'

const KIND_LABELS: Record<string, string> = {
  activity: 'Activity Type',
  screentime_category: 'Screentime Category',
  tag: 'Tag Name',
}

const KINDS: Array<DeductionRuleCondition['kind']> = ['activity', 'tag', 'screentime_category']

// ============================================================================
// Single condition card
// ============================================================================

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
    const base: DeductionRuleCondition = { kind: newKind }
    if (newKind === 'activity') base.activity_type = ''
    if (newKind === 'tag') base.tag_name = ''
    if (newKind === 'screentime_category') base.category = []
    onChange(index, base)
  }

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
          <select
            value={condition.activity_type ?? ''}
            onChange={(e) =>
              onChange(index, { ...condition, activity_type: (e.target as HTMLSelectElement).value })
            }
            class="condition-field-select"
          >
            <option value="">-- select activity type --</option>
            {definitions.map((d) => (
              <option key={d.name} value={d.name}>
                {d.display_name} ({d.name})
              </option>
            ))}
          </select>
        )}

        {condition.kind === 'tag' && (
          <input
            type="text"
            value={condition.tag_name ?? ''}
            onInput={(e) => onChange(index, { ...condition, tag_name: (e.target as HTMLInputElement).value })}
            placeholder="Tag name"
            class="condition-field-input"
          />
        )}

        {condition.kind === 'screentime_category' && (
          <input
            type="text"
            value={condition.category?.join(', ') ?? ''}
            onInput={(e) =>
              onChange(index, {
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
