/**
 * Deduction Rule detail/edit page.
 * Handles both editing existing rules and creating new ones (/deduction-rules/new).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useRoute } from 'preact-iso'
import { useCallback, useEffect, useState } from 'preact/hooks'

import type { ActivityTypeDefinition, DeductionRuleCondition } from '../../state/api'

import { ConditionBuilder } from '../../components/ConditionBuilder'
import { ConfirmButton } from '../../components/ConfirmButton'
import { SaveStatusIndicator, useSaveStatus } from '../../components/SaveStatusIndicator'
import {
  createDeductionRule,
  deleteDeductionRule,
  fetchActivityTypeDefinitions,
  fetchDeductionRules,
  updateDeductionRule,
} from '../../state/api'
import { auth } from '../../state/auth'
import './style.css'

// ============================================================================
// Auto-save text input
// ============================================================================

function AutoSaveText({
  label,
  value,
  onSave,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onSave: (v: string) => void
  placeholder?: string
  type?: string
}) {
  const [local, setLocal] = useState(value)

  useEffect(() => {
    setLocal(value)
  }, [value])

  const handleBlur = () => {
    if (local !== value) onSave(local)
  }

  return (
    <div class="rule-field">
      <span class="rule-field-label">{label}</span>
      <input
        type={type}
        value={local}
        onInput={(e) => setLocal((e.target as HTMLInputElement).value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        class="rule-field-input"
      />
    </div>
  )
}

// ============================================================================
// Activity type picker
// ============================================================================

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

// ============================================================================
// New rule form
// ============================================================================

function NewRuleForm() {
  const { route } = useLocation()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [outputType, setOutputType] = useState('')
  const [outputTitle, setOutputTitle] = useState('')
  const [mergeGapMinutes, setMergeGapMinutes] = useState('')
  const [priority, setPriority] = useState(1)
  const [enabled, setEnabled] = useState(true)
  const [conditions, setConditions] = useState<DeductionRuleCondition[]>([{ kind: 'activity' }])

  const { data: definitions = [] } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 5 * 60_000,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      createDeductionRule({
        conditions,
        enabled,
        merge_gap_seconds: mergeGapMinutes ? Number(mergeGapMinutes) * 60 : undefined,
        name,
        output_activity_type: outputType,
        output_title: outputTitle || undefined,
        priority,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['deductionRules'] })
      route(`/deduction-rules/${created.id}`)
    },
  })

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <h1>New Deduction Rule</h1>
      </div>

      <div class="rule-detail">
        <section class="rule-section">
          <div class="rule-field">
            <span class="rule-field-label">Name</span>
            <input
              type="text"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              placeholder="Rule name"
              class="rule-field-input"
            />
          </div>

          <ActivityTypePicker value={outputType} onChange={setOutputType} definitions={definitions} />

          <div class="rule-field">
            <span class="rule-field-label">Output Title</span>
            <input
              type="text"
              value={outputTitle}
              onInput={(e) => setOutputTitle((e.target as HTMLInputElement).value)}
              placeholder="Optional title"
              class="rule-field-input"
            />
          </div>

          <div class="rule-field">
            <span class="rule-field-label">Merge Gap (minutes)</span>
            <input
              type="number"
              value={mergeGapMinutes}
              onInput={(e) => setMergeGapMinutes((e.target as HTMLInputElement).value)}
              placeholder="e.g. 5"
              class="rule-field-input"
            />
          </div>

          <div class="rule-field">
            <span class="rule-field-label">Priority</span>
            <select
              value={priority}
              onChange={(e) => setPriority(Number((e.target as HTMLSelectElement).value))}
              class="rule-field-select"
            >
              <option value={0}>0 - Low</option>
              <option value={1}>1 - Normal</option>
              <option value={2}>2 - High</option>
            </select>
          </div>

          <div class="rule-field">
            <label class="rule-checkbox">
              <input type="checkbox" checked={enabled} onChange={() => setEnabled(!enabled)} />
              <span>Enabled</span>
            </label>
          </div>
        </section>

        <section class="rule-section">
          <h2>Conditions</h2>
          <ConditionBuilder conditions={conditions} onChange={setConditions} />
        </section>

        <div class="rule-footer">
          <button
            type="button"
            class="note-action-btn"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !name || !outputType}
          >
            {createMutation.isPending ? 'Creating...' : 'Create Rule'}
          </button>
          {createMutation.isError && <p class="rule-error">{(createMutation.error as Error).message}</p>}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Edit rule form
// ============================================================================

function EditRuleForm({ id }: { id: string }) {
  const { route } = useLocation()
  const queryClient = useQueryClient()
  const [saveStatus, setSaveStatus] = useSaveStatus(3000)

  const { data: rule, isLoading } = useQuery({
    queryFn: fetchDeductionRules,
    queryKey: ['deductionRules'],
    select: (data) => data.find((r) => r.id === id),
  })

  const { data: definitions = [] } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 5 * 60_000,
  })

  const [conditions, setConditions] = useState<DeductionRuleCondition[]>([])
  const [conditionsDirty, setConditionsDirty] = useState(false)

  useEffect(() => {
    if (rule) {
      setConditions(rule.conditions)
      setConditionsDirty(false)
    }
  }, [rule])

  const updateMutation = useMutation({
    mutationFn: (body: Parameters<typeof updateDeductionRule>[1]) => updateDeductionRule(id, body),
    onMutate: () => setSaveStatus({ status: 'saving' }),
    onSuccess: () => {
      setSaveStatus({ status: 'saved' })
      queryClient.invalidateQueries({ queryKey: ['deductionRules'] })
    },
    onError: () => {
      setSaveStatus({ status: 'error' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteDeductionRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deductionRules'] })
      route('/deduction-rules')
    },
  })

  const autoSave = useCallback(
    (body: Parameters<typeof updateDeductionRule>[1]) => {
      updateMutation.mutate(body)
    },
    [updateMutation.mutate],
  )

  const handleConditionsChange = useCallback((newConditions: DeductionRuleCondition[]) => {
    setConditions(newConditions)
    setConditionsDirty(true)
  }, [])

  const saveConditions = useCallback(() => {
    autoSave({ conditions })
    setConditionsDirty(false)
  }, [conditions, autoSave])

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

  const mergeGapMinutes = rule.merge_gap_seconds ? String(rule.merge_gap_seconds / 60) : ''

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <div class="rule-header-row">
          <h1>{rule.name}</h1>
          <SaveStatusIndicator state={saveStatus} variant="compact" />
        </div>
        <a href="/deduction-rules" class="rule-back-link">
          Back to rules
        </a>
      </div>

      <div class="rule-detail">
        <section class="rule-section">
          <AutoSaveText label="Name" value={rule.name} onSave={(v) => autoSave({ name: v })} />

          <ActivityTypePicker
            value={rule.output_activity_type}
            onChange={(v) => autoSave({ output_activity_type: v })}
            definitions={definitions}
          />

          <AutoSaveText
            label="Output Title"
            value={rule.output_title ?? ''}
            onSave={(v) => autoSave({ output_title: v || null })}
            placeholder="Optional title"
          />

          <AutoSaveText
            label="Merge Gap (minutes)"
            value={mergeGapMinutes}
            onSave={(v) => autoSave({ merge_gap_seconds: v ? Number(v) * 60 : null })}
            placeholder="e.g. 5"
            type="number"
          />

          <div class="rule-field">
            <span class="rule-field-label">Priority</span>
            <select
              value={rule.priority}
              onChange={(e) => autoSave({ priority: Number((e.target as HTMLSelectElement).value) })}
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
                checked={rule.enabled}
                onChange={() => autoSave({ enabled: !rule.enabled })}
              />
              <span>Enabled</span>
            </label>
          </div>
        </section>

        <section class="rule-section">
          <h2>Conditions</h2>
          <ConditionBuilder conditions={conditions} onChange={handleConditionsChange} />
          {conditionsDirty && (
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

        <section class="rule-section rule-danger-zone">
          <ConfirmButton
            label="Delete Rule"
            confirmMessage={`Delete rule "${rule.name}"?`}
            onConfirm={() => deleteMutation.mutate()}
            isPending={deleteMutation.isPending}
            pendingLabel="Deleting..."
          />
        </section>
      </div>
    </div>
  )
}

// ============================================================================
// Main export — dispatches between new and edit
// ============================================================================

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
    return <NewRuleForm />
  }

  return <EditRuleForm id={id} />
}
