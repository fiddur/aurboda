/**
 * Deduction Rule detail/edit page.
 * Handles both editing existing rules and creating new ones (/deduction-rules/new).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatISO } from 'date-fns'
import { useLocation, useRoute } from 'preact-iso'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import type { ActivityTypeDefinition, DeductionRule, DeductionRuleCondition } from '../../state/api'

import { ConditionBuilder } from '../../components/ConditionBuilder'
import { ConfirmButton } from '../../components/ConfirmButton'
import { SaveStatusIndicator, useSaveStatus } from '../../components/SaveStatusIndicator'
import {
  createDeductionRule,
  deleteDeductionRule,
  fetchActivityTypeDefinitions,
  fetchDeductionRules,
  previewDeductionRule,
  updateDeductionRule,
} from '../../state/api'
import { auth } from '../../state/auth'
import './style.css'

// ============================================================================
// Field components
// ============================================================================

function TextField({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
  type?: string
}) {
  return (
    <div class="rule-field">
      <span class="rule-field-label">{label}</span>
      <input
        type={type}
        value={value}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        onBlur={onBlur}
        placeholder={placeholder}
        class="rule-field-input"
      />
    </div>
  )
}

function ActivityTypePicker({
  value,
  onChange,
  definitions,
}: {
  value: string
  onChange: (v: string) => void
  definitions: ActivityTypeDefinition[]
}) {
  return (
    <div class="rule-field">
      <span class="rule-field-label">Output Activity Type</span>
      <select
        value={value}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
        class="rule-field-select"
      >
        <option value="">-- select --</option>
        {definitions.map((d) => (
          <option key={d.name} value={d.name}>
            {d.display_name} ({d.name})
          </option>
        ))}
      </select>
    </div>
  )
}

function OutputDataEditor({
  data,
  onChange,
}: {
  data: Record<string, unknown>
  onChange: (data: Record<string, unknown>) => void
}) {
  const entries = Object.entries(data)

  const updateKey = (oldKey: string, newKey: string) => {
    const next: Record<string, unknown> = {}
    for (const [k, v] of entries) {
      next[k === oldKey ? newKey : k] = v
    }
    onChange(next)
  }

  const updateValue = (key: string, value: string) => {
    onChange({ ...data, [key]: value })
  }

  const removeEntry = (key: string) => {
    const next = { ...data }
    delete next[key]
    onChange(next)
  }

  const addEntry = () => {
    onChange({ ...data, '': '' })
  }

  return (
    <div class="rule-field">
      <span class="rule-field-label">Output Data</span>
      <div class="output-data-entries">
        {entries.map(([key, value], i) => (
          <div class="output-data-row" key={i}>
            <input
              type="text"
              value={key}
              onInput={(e) => updateKey(key, (e.target as HTMLInputElement).value)}
              placeholder="key"
              class="rule-field-input output-data-key"
            />
            <input
              type="text"
              value={String(value ?? '')}
              onInput={(e) => updateValue(key, (e.target as HTMLInputElement).value)}
              placeholder="value"
              class="rule-field-input output-data-value"
            />
            <button type="button" class="condition-remove-btn" onClick={() => removeEntry(key)}>
              &#x2715;
            </button>
          </div>
        ))}
      </div>
      <button type="button" class="note-action-btn" onClick={addEntry} style={{ marginTop: '0.25rem' }}>
        + Add Field
      </button>
    </div>
  )
}

// ============================================================================
// Unified rule form
// ============================================================================

interface RuleFormFields {
  conditions: DeductionRuleCondition[]
  enabled: boolean
  mergeGapMinutes: string
  mode: 'create' | 'enrich'
  name: string
  outputData: Record<string, unknown>
  outputTitle: string
  outputType: string
  priority: number
}

const defaultFields: RuleFormFields = {
  conditions: [{ kind: 'activity' }],
  enabled: true,
  mergeGapMinutes: '',
  mode: 'create',
  name: '',
  outputData: {},
  outputTitle: '',
  outputType: '',
  priority: 1,
}

const ruleToFields = (rule: DeductionRule): RuleFormFields => ({
  conditions: rule.conditions,
  enabled: rule.enabled,
  mergeGapMinutes: rule.merge_gap_seconds ? String(rule.merge_gap_seconds / 60) : '',
  mode: rule.mode ?? 'create',
  name: rule.name,
  outputData: rule.output_data ?? {},
  outputTitle: rule.output_title ?? '',
  outputType: rule.output_activity_type,
  priority: rule.priority,
})

const fieldsToBuildBody = (f: RuleFormFields) => ({
  conditions: f.conditions,
  enabled: f.enabled,
  merge_gap_seconds: f.mergeGapMinutes ? Number(f.mergeGapMinutes) * 60 : undefined,
  mode: f.mode !== 'create' ? f.mode : undefined,
  name: f.name,
  output_activity_type: f.outputType,
  output_data: Object.keys(f.outputData).length > 0 ? f.outputData : undefined,
  output_title: f.outputTitle || undefined,
  priority: f.priority,
})

// eslint-disable-next-line complexity -- unified form handling create + edit modes
function RuleForm({ id, rule }: { id?: string; rule?: DeductionRule }) {
  const isNew = !rule
  const { route } = useLocation()
  const queryClient = useQueryClient()
  const [saveStatus, setSaveStatus] = useSaveStatus(3000)

  const [fields, setFields] = useState<RuleFormFields>(rule ? ruleToFields(rule) : defaultFields)
  const [conditionsDirty, setConditionsDirty] = useState(false)
  const [previewResult, setPreviewResult] = useState<{
    would_affect: number
    sample_days: number
  } | null>(null)

  // Track previous rule values for auto-save field-change detection
  const prevRule = useRef(rule)

  const { data: definitions = [] } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 5 * 60_000,
  })

  // Sync local state when server data refreshes (edit mode)
  useEffect(() => {
    if (rule) {
      setFields(ruleToFields(rule))
      setConditionsDirty(false)
      prevRule.current = rule
    }
  }, [rule])

  // ── Mutations ──

  const updateMutation = useMutation({
    mutationFn: (body: Parameters<typeof updateDeductionRule>[1]) => updateDeductionRule(id!, body),
    onMutate: () => setSaveStatus({ status: 'saving' }),
    onSuccess: () => {
      setSaveStatus({ status: 'saved' })
      queryClient.invalidateQueries({ queryKey: ['deductionRules'] })
    },
    onError: () => setSaveStatus({ status: 'error' }),
  })

  const createMutation = useMutation({
    mutationFn: () => createDeductionRule(fieldsToBuildBody(fields)),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['deductionRules'] })
      route(`/deduction-rules/${created.id}`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteDeductionRule(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deductionRules'] })
      route('/deduction-rules')
    },
  })

  const previewMutation = useMutation({
    mutationFn: () => previewDeductionRule(fieldsToBuildBody(fields)),
    onSuccess: (result) => setPreviewResult(result),
  })

  // ── Field helpers ──

  const autoSave = useCallback(
    (body: Parameters<typeof updateDeductionRule>[1]) => {
      if (!isNew) updateMutation.mutate(body)
    },
    [isNew, updateMutation.mutate],
  )

  const updateField = <K extends keyof RuleFormFields>(key: K, value: RuleFormFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  const handleConditionsChange = useCallback((newConditions: DeductionRuleCondition[]) => {
    setFields((prev) => ({ ...prev, conditions: newConditions }))
    setConditionsDirty(true)
  }, [])

  const saveConditions = useCallback(() => {
    autoSave({ conditions: fields.conditions })
    setConditionsDirty(false)
  }, [fields.conditions, autoSave])

  const canSubmit = Boolean(fields.name && fields.outputType)

  // ── Render ──

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <div class="rule-header-row">
          <h1>{isNew ? 'New Deduction Rule' : fields.name}</h1>
          {!isNew && <SaveStatusIndicator state={saveStatus} variant="compact" />}
        </div>
        {!isNew && (
          <a href="/deduction-rules" class="rule-back-link">
            Back to rules
          </a>
        )}
      </div>

      <div class="rule-detail">
        <section class="rule-section">
          <TextField
            label="Name"
            value={fields.name}
            onChange={(v) => updateField('name', v)}
            onBlur={() => !isNew && fields.name !== rule?.name && autoSave({ name: fields.name })}
            placeholder="Rule name"
          />

          <div class="rule-field">
            <span class="rule-field-label">Mode</span>
            <select
              value={fields.mode}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value as 'create' | 'enrich'
                updateField('mode', v)
                autoSave({ mode: v })
              }}
              class="rule-field-select"
            >
              <option value="create">Create new activities</option>
              <option value="enrich">Enrich existing activities</option>
            </select>
          </div>

          <ActivityTypePicker
            value={fields.outputType}
            onChange={(v) => {
              updateField('outputType', v)
              autoSave({ output_activity_type: v })
            }}
            definitions={definitions}
          />

          <OutputDataEditor
            data={fields.outputData}
            onChange={(data) => {
              updateField('outputData', data)
              autoSave({ output_data: Object.keys(data).length > 0 ? data : null })
            }}
          />

          <TextField
            label="Output Title"
            value={fields.outputTitle}
            onChange={(v) => updateField('outputTitle', v)}
            onBlur={() =>
              !isNew &&
              fields.outputTitle !== (rule?.output_title ?? '') &&
              autoSave({ output_title: fields.outputTitle || null })
            }
            placeholder="Optional title"
          />

          <TextField
            label="Merge Gap (minutes)"
            value={fields.mergeGapMinutes}
            onChange={(v) => updateField('mergeGapMinutes', v)}
            onBlur={() => {
              if (isNew) return
              const current = fields.mergeGapMinutes ? Number(fields.mergeGapMinutes) * 60 : null
              const prev = rule?.merge_gap_seconds ?? null
              if (current !== prev) autoSave({ merge_gap_seconds: current })
            }}
            placeholder="e.g. 5"
            type="number"
          />

          <div class="rule-field">
            <span class="rule-field-label">Priority</span>
            <select
              value={fields.priority}
              onChange={(e) => {
                const v = Number((e.target as HTMLSelectElement).value)
                updateField('priority', v)
                autoSave({ priority: v })
              }}
              class="rule-field-select"
            >
              <option value={0}>0 - Low</option>
              <option value={1}>1 - Normal</option>
              <option value={2}>2 - High</option>
            </select>
          </div>

          <div class="rule-field">
            <label class="rule-checkbox">
              <input
                type="checkbox"
                checked={fields.enabled}
                onChange={() => {
                  const v = !fields.enabled
                  updateField('enabled', v)
                  autoSave({ enabled: v })
                }}
              />
              <span>Enabled</span>
            </label>
          </div>
        </section>

        <section class="rule-section">
          <h2>Conditions</h2>
          <ConditionBuilder conditions={fields.conditions} onChange={handleConditionsChange} />
          {!isNew && conditionsDirty && (
            <button
              type="button"
              class="note-action-btn"
              onClick={saveConditions}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Conditions'}
            </button>
          )}
        </section>

        {isNew ? (
          <div class="rule-footer">
            <button
              type="button"
              class="note-action-btn rule-preview-btn"
              onClick={() => previewMutation.mutate()}
              disabled={previewMutation.isPending || !canSubmit}
            >
              {previewMutation.isPending ? 'Previewing...' : 'Preview'}
            </button>
            <button
              type="button"
              class="note-action-btn"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !canSubmit}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Rule'}
            </button>
            {previewResult && (
              <span class="rule-preview-result">
                Would affect {previewResult.would_affect} activities ({previewResult.sample_days}-day sample)
              </span>
            )}
            {createMutation.isError && <p class="rule-error">{(createMutation.error as Error).message}</p>}
          </div>
        ) : (
          <>
            <section class="rule-section">
              <a
                href={`/data?date=${formatISO(new Date(), { representation: 'date' })}&types=${encodeURIComponent(fields.outputType)}&deduction_rule_id=${id}&hide=location,music,meal,report,screentime`}
                class="note-action-btn"
                style={{ display: 'inline-block', textAlign: 'center', textDecoration: 'none' }}
              >
                View activities (last 90 days)
              </a>
            </section>

            <section class="rule-section rule-danger-zone">
              <ConfirmButton
                label="Delete Rule"
                confirmMessage={`Delete rule "${fields.name}"?`}
                onConfirm={() => deleteMutation.mutate()}
                isPending={deleteMutation.isPending}
                pendingLabel="Deleting..."
              />
            </section>
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Main export — fetches data for edit, dispatches to RuleForm
// ============================================================================

function EditRuleLoader({ id }: { id: string }) {
  const { data: rule, isLoading } = useQuery({
    queryFn: fetchDeductionRules,
    queryKey: ['deductionRules'],
    select: (data) => data.find((r) => r.id === id),
  })

  if (isLoading) {
    return (
      <div class="data-sources-page">
        <p class="loading">Loading rule...</p>
      </div>
    )
  }

  if (!rule) {
    return (
      <div class="data-sources-page">
        <p>Rule not found.</p>
        <a href="/deduction-rules">Back to rules</a>
      </div>
    )
  }

  return <RuleForm id={id} rule={rule} />
}

export function DeductionRuleDetail() {
  const { params } = useRoute()
  const id = params.id as string

  if (!auth.value.token) {
    return (
      <div class="data-sources-page">
        <p>Please log in to manage deduction rules.</p>
      </div>
    )
  }

  if (id === 'new') {
    return <RuleForm />
  }

  return <EditRuleLoader id={id} />
}
