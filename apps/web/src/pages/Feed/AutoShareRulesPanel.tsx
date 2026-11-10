/**
 * Auto-share rules panel (#903): rules that automatically publish settled
 * activities to the federated feed — "share runs longer than 15 minutes".
 *
 * Rules are created DISABLED and the enable toggle states plainly what will
 * leave the instance: enabling is the deliberate act. A preview shows how many
 * activities in the last 30 days would have matched, BEFORE anything is on.
 * Enabling only affects activities that arrive afterwards — never history.
 *
 * Each rule opens in the same form, prefilled, to see and edit its settings.
 * An edit changes what the rule shares from then on; posts it already
 * published stay as they were.
 */
import type { AutoshareRule, DataFieldDefinition } from '@aurboda/api-spec'

import { feedPostMessageMaxLength } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { ActivityTypePicker } from '../../components/ActivityTypePicker'
import { SERIES_METRICS, SUMMARY_METRICS } from '../../components/feed-metrics'
import { KnownValuesInput } from '../../components/KnownValuesInput'
import { fieldLabel, scalarFields } from '../../components/sessions/sessionView'
import { TagsInput } from '../../components/TagsInput'
import { FEED_VISIBILITY_OPTIONS, VisibilitySelector } from '../../components/VisibilitySelector'
import {
  type ActivityTypeDefinition,
  addAutoshareRule,
  deleteAutoshareRule,
  fetchActivityTypeDefinitions,
  listAutoshareRules,
  previewAutoshareRule,
  updateAutoshareRule,
} from '../../state/api'
import {
  emptyRuleFormState,
  formStateTagsText,
  formStateToAddBody,
  formStateToUpdateBody,
  ruleHasManyActivityTypes,
  type RuleFormState,
  ruleToFormState,
} from './autoshare-rule-form'
import {
  DATA_FILTER_OPERATOR_LABELS,
  DATA_FILTER_OPERATORS,
  type DataFilterOperator,
  type DataFilterRow,
  dataFilterRowComplete,
  newDataFilterRow,
  operatorTakesValue,
  ruleSummary,
  ruleTagsText,
} from './autoshare-rule-text'

const toggleKey = <T extends string>(set: Set<T>, key: T): Set<T> => {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

const useActivityTypeDefinitions = () =>
  useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 5 * 60_000,
  }).data ?? []

const schemaFieldsOf = (definitions: ActivityTypeDefinition[], activityType: string): DataFieldDefinition[] =>
  scalarFields(definitions.find((definition) => definition.name === activityType)?.data_schema)

function DataConditionRow({
  activityType,
  row,
  schemaFields,
  onChange,
  onRemove,
}: {
  activityType: string
  row: DataFilterRow
  schemaFields: DataFieldDefinition[]
  onChange: (row: DataFilterRow) => void
  onRemove: () => void
}) {
  const knownField = schemaFields.some((field) => field.name === row.field)
  const offerValues = activityType !== '' && knownField && operatorTakesValue(row.operator)
  return (
    <div class="autoshare-condition-row">
      {schemaFields.length > 0 ? (
        <select
          aria-label="Data field"
          value={row.field}
          onChange={(e) => onChange({ ...row, field: (e.target as HTMLSelectElement).value })}
        >
          {!knownField && <option value={row.field}>{row.field || 'Choose a field'}</option>}
          {schemaFields.map((field) => (
            <option key={field.name} value={field.name}>
              {fieldLabel(field)}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          aria-label="Data field"
          placeholder="field, e.g. session_name"
          value={row.field}
          onInput={(e) => onChange({ ...row, field: (e.target as HTMLInputElement).value })}
        />
      )}
      <select
        aria-label="Condition"
        value={row.operator}
        onChange={(e) =>
          onChange({ ...row, operator: (e.target as HTMLSelectElement).value as DataFilterOperator })
        }
      >
        {DATA_FILTER_OPERATORS.map((operator) => (
          <option key={operator} value={operator}>
            {DATA_FILTER_OPERATOR_LABELS[operator]}
          </option>
        ))}
      </select>
      {operatorTakesValue(row.operator) &&
        (offerValues ? (
          <KnownValuesInput
            activityType={activityType}
            field={row.field}
            aria-label="Value"
            placeholder="Value"
            value={row.value}
            onChange={(value) => onChange({ ...row, value })}
          />
        ) : (
          <input
            type="text"
            aria-label="Value"
            placeholder="Value"
            value={row.value}
            onInput={(e) => onChange({ ...row, value: (e.target as HTMLInputElement).value })}
          />
        ))}
      <button type="button" class="btn-secondary" onClick={onRemove} title="Remove condition">
        Remove
      </button>
    </div>
  )
}

function RuleRow({ rule, postCount }: { rule: AutoshareRule; postCount: number }) {
  const [editing, setEditing] = useState(false)
  const definitions = useActivityTypeDefinitions()
  const labelFor = (field: string): string | undefined => {
    for (const activityType of rule.activity_types) {
      const known = schemaFieldsOf(definitions, activityType).find((candidate) => candidate.name === field)
      if (known) return fieldLabel(known)
    }
    return undefined
  }
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['autoshare-rules'] })
  const toggle = useMutation({
    mutationFn: () => updateAutoshareRule(rule.id, { enabled: !rule.enabled }),
    onError: () => alert('Failed to update the rule.'),
    onSuccess: invalidate,
  })
  const del = useMutation({
    mutationFn: () => deleteAutoshareRule(rule.id),
    onError: () => alert('Failed to delete the rule.'),
    onSuccess: invalidate,
  })

  // Cancelling in `onClick` keeps the browser from flipping the checkbox at all;
  // in `onChange` it would already show the declined state.
  const onToggleClick = (e: MouseEvent) => {
    if (
      !rule.enabled &&
      !window.confirm(
        `Enable "${rule.name}"?\n\nFrom now on, newly synced activities matching it are ` +
          `AUTOMATICALLY published to your federated feed (${rule.visibility}) with the ` +
          `selected metrics — without asking again. Nothing already synced is shared.`,
      )
    ) {
      e.preventDefault()
    }
  }

  return (
    <li class="autoshare-rule-item">
      <div class="autoshare-rule-row">
        <div class="autoshare-rule-main">
          <span class="autoshare-rule-name">{rule.name}</span>
          <span class="autoshare-rule-meta">
            {ruleSummary(rule, labelFor)} · {ruleTagsText(rule)}
            {postCount > 0 && ` · ${postCount} post${postCount === 1 ? '' : 's'} auto-shared`}
          </span>
        </div>
        <div class="autoshare-rule-actions">
          <label class="autoshare-rule-toggle">
            <input
              type="checkbox"
              checked={rule.enabled}
              onClick={onToggleClick}
              onChange={() => toggle.mutate()}
              disabled={toggle.isPending}
            />
            {rule.enabled ? 'On' : 'Off'}
          </label>
          <button type="button" class="btn-secondary" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Close' : 'Edit'}
          </button>
          <button
            type="button"
            class="btn-danger"
            onClick={() => window.confirm(`Delete "${rule.name}"?`) && del.mutate()}
            disabled={del.isPending}
          >
            Delete
          </button>
        </div>
      </div>
      {editing && (
        <RuleForm
          rule={rule}
          onDone={() => {
            setEditing(false)
            invalidate()
          }}
        />
      )}
    </li>
  )
}

// eslint-disable-next-line complexity -- one form, one field per predicate/template knob
function RuleForm({ rule, onDone }: { rule?: AutoshareRule; onDone: () => void }) {
  const [state, setState] = useState<RuleFormState>(() =>
    rule ? ruleToFormState(rule) : emptyRuleFormState(),
  )
  const [preview, setPreview] = useState<{ would_match: number; sample_days: number } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const set = (patch: Partial<RuleFormState>) => setState((current) => ({ ...current, ...patch }))
  const setConditions = (update: (rows: DataFilterRow[]) => DataFilterRow[]) =>
    setState((current) => ({ ...current, conditions: update(current.conditions) }))

  const manyTypes = rule !== undefined && ruleHasManyActivityTypes(rule)
  const { activityType, conditions, summary, series } = state
  const schemaFields = schemaFieldsOf(useActivityTypeDefinitions(), activityType)
  const updateCondition = (index: number, row: DataFilterRow) =>
    setConditions((rows) => rows.map((current, i) => (i === index ? row : current)))
  const conditionsComplete = conditions.every(dataFilterRowComplete)

  const previewMutation = useMutation({
    mutationFn: () => previewAutoshareRule(formStateToAddBody(state, rule)),
    onError: (err) => {
      setPreview(null)
      setPreviewError(err.message)
    },
    onSuccess: (result) => {
      setPreviewError(null)
      setPreview({ sample_days: result.sample_days ?? 30, would_match: result.would_match ?? 0 })
    },
  })
  const saveMutation = useMutation({
    mutationFn: () =>
      rule
        ? updateAutoshareRule(rule.id, formStateToUpdateBody(state, rule))
        : addAutoshareRule(formStateToAddBody(state)),
    onError: () => alert(rule ? 'Failed to save the rule.' : 'Failed to create the rule.'),
    onSuccess: onDone,
  })

  const canSubmit = state.name.trim() !== '' && conditionsComplete && !saveMutation.isPending
  // A prefilled value set through the API need not sit on the input's step.
  const step = (createStep: string) => (rule ? 'any' : createStep)

  return (
    <form
      class="autoshare-create"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) saveMutation.mutate()
      }}
    >
      {rule?.enabled && (
        <p class="autoshare-edit-note">
          This rule is on. Saved changes apply to activities shared from now on; posts it has already
          published are not changed.
        </p>
      )}
      <label>
        Name
        <input
          type="text"
          value={state.name}
          placeholder="e.g. Runs longer than 15 minutes"
          onInput={(e) => set({ name: (e.target as HTMLInputElement).value })}
        />
      </label>

      <div class="autoshare-create-row">
        {manyTypes ? (
          <p class="autoshare-edit-note">
            Activity types: {rule.activity_types.join(', ')} (edit via API/MCP)
          </p>
        ) : (
          <label>
            Activity type (empty = any)
            <ActivityTypePicker value={activityType} onChange={(value) => set({ activityType: value })} />
          </label>
        )}
        <label>
          Min duration (minutes)
          <input
            type="number"
            min="1"
            step={step('1')}
            value={state.minMinutes}
            onInput={(e) => set({ minMinutes: (e.target as HTMLInputElement).value })}
          />
        </label>
        <label>
          Min distance (km)
          <input
            type="number"
            min="0.1"
            step={step('0.1')}
            value={state.minKm}
            onInput={(e) => set({ minKm: (e.target as HTMLInputElement).value })}
          />
        </label>
        <label>
          Only activities that ended within (hours)
          <input
            type="number"
            min="1"
            max="8760"
            step="1"
            value={state.maxAgeHours}
            onInput={(e) => set({ maxAgeHours: (e.target as HTMLInputElement).value })}
          />
        </label>
      </div>

      <fieldset class="share-dialog-group">
        <legend>Data conditions (all must hold)</legend>
        {conditions.map((row, index) => (
          <DataConditionRow
            key={index}
            activityType={activityType}
            row={row}
            schemaFields={schemaFields}
            onChange={(updated) => updateCondition(index, updated)}
            onRemove={() => setConditions((rows) => rows.filter((_, i) => i !== index))}
          />
        ))}
        <button
          type="button"
          class="btn-secondary"
          onClick={() => setConditions((rows) => [...rows, newDataFilterRow(schemaFields[0]?.name)])}
        >
          Add condition
        </button>
      </fieldset>

      <fieldset class="share-dialog-group">
        <legend>Summary metrics to publish</legend>
        <div class="share-dialog-options">
          {SUMMARY_METRICS.map(({ key, label }) => (
            <label key={key} class="share-dialog-checkbox">
              <input
                type="checkbox"
                checked={summary.has(key)}
                onChange={() =>
                  setState((current) => ({ ...current, summary: toggleKey(current.summary, key) }))
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset class="share-dialog-group">
        <legend>Full time-series to publish (more revealing — off by default)</legend>
        <div class="share-dialog-options">
          {SERIES_METRICS.map(({ key, label }) => (
            <label key={key} class="share-dialog-checkbox">
              <input
                type="checkbox"
                checked={series.has(key)}
                onChange={() =>
                  setState((current) => ({ ...current, series: toggleKey(current.series, key) }))
                }
              />
              {label}
            </label>
          ))}
          <label class="share-dialog-checkbox">
            <input
              type="checkbox"
              checked={state.includeMap}
              onChange={(e) => set({ includeMap: (e.target as HTMLInputElement).checked })}
            />
            Route map
          </label>
          <label class="share-dialog-checkbox">
            <input
              type="checkbox"
              checked={state.includeExercises}
              onChange={(e) => set({ includeExercises: (e.target as HTMLInputElement).checked })}
            />
            Exercises (sets, e1RM, volume)
          </label>
        </div>
      </fieldset>

      <label>
        Fixed message on auto-created posts (optional; any #hashtags in it are added to the post's tags)
        <input
          type="text"
          maxLength={feedPostMessageMaxLength}
          value={state.message}
          onInput={(e) => set({ message: (e.target as HTMLInputElement).value })}
        />
      </label>

      <fieldset class="share-dialog-group">
        <legend>Tags</legend>
        <label class="share-dialog-checkbox">
          <input
            type="checkbox"
            checked={!state.ownTags}
            onChange={(e) => set({ ownTags: !(e.target as HTMLInputElement).checked })}
          />
          Use my default tags (set in Settings)
        </label>
        {state.ownTags && (
          <TagsInput
            legend="This rule's tags"
            value={state.tagsText}
            onInput={(tagsText) => set({ tagsText })}
            note="These replace your default tags on this rule's posts."
          />
        )}
        <p class="share-dialog-note">
          This rule's posts get: {formStateTagsText(state)}, plus the activity type tag when that is on in
          Settings.
        </p>
      </fieldset>

      <VisibilitySelector
        name={rule ? `autoshare-visibility-${rule.id}` : 'autoshare-visibility'}
        options={FEED_VISIBILITY_OPTIONS}
        value={state.visibility}
        onChange={(visibility) => set({ visibility })}
      />

      <div class="autoshare-create-actions">
        <button
          type="button"
          class="btn-secondary"
          onClick={() => previewMutation.mutate()}
          disabled={previewMutation.isPending || !conditionsComplete}
        >
          {previewMutation.isPending ? 'Previewing…' : 'Preview'}
        </button>
        <button type="submit" class="btn-primary" disabled={!canSubmit}>
          {rule ? 'Save' : 'Create (starts off)'}
        </button>
      </div>
      {preview && (
        <p class="autoshare-preview-result">
          Would have matched <strong>{preview.would_match}</strong> activities in the last{' '}
          {preview.sample_days} days.
        </p>
      )}
      {previewError && <p class="autoshare-preview-result autoshare-preview-error">{previewError}</p>}
    </form>
  )
}

export function AutoShareRulesPanel() {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const { data } = useQuery({ queryFn: listAutoshareRules, queryKey: ['autoshare-rules'] })
  const rules = data?.rules ?? []
  const counts = data?.post_counts ?? {}

  return (
    <section class="autoshare-section">
      <div class="feed-section-header">
        <h2 class="feed-section-title">Auto-share rules</h2>
        <button type="button" class="btn-secondary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Close' : 'New rule'}
        </button>
      </div>
      <p class="autoshare-intro">
        Automatically publish matching activities to your feed once they've settled after a sync. Rules start{' '}
        <strong>off</strong>; enabling one means matching data leaves this instance without further
        confirmation.
      </p>
      {creating && (
        <RuleForm
          onDone={() => {
            setCreating(false)
            queryClient.invalidateQueries({ queryKey: ['autoshare-rules'] })
          }}
        />
      )}
      {rules.length > 0 && (
        <ul class="autoshare-rule-list">
          {rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} postCount={counts[rule.id] ?? 0} />
          ))}
        </ul>
      )}
    </section>
  )
}
