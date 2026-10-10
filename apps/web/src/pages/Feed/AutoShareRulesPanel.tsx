/**
 * Auto-share rules panel (#903): rules that automatically publish settled
 * activities to the federated feed — "share runs longer than 15 minutes".
 *
 * Rules are created DISABLED and the enable toggle states plainly what will
 * leave the instance: enabling is the deliberate act. A preview shows how many
 * activities in the last 30 days would have matched, BEFORE anything is on.
 * Enabling only affects activities that arrive afterwards — never history.
 */
import type {
  AddAutoshareRuleBody,
  AutoshareRule,
  DataFieldDefinition,
  FeedVisibility,
  MetricType,
} from '@aurboda/api-spec'

import { feedPostMessageMaxLength } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { ActivityTypePicker } from '../../components/ActivityTypePicker'
import { DEFAULT_SUMMARY, SERIES_METRICS, SUMMARY_METRICS } from '../../components/feed-metrics'
import { fieldLabel } from '../../components/sessions/sessionView'
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
import { KnownValues } from '../EntityDetail/SchemaDataFields'
import {
  DATA_FILTER_OPERATOR_LABELS,
  DATA_FILTER_OPERATORS,
  type DataFilterOperator,
  type DataFilterRow,
  dataFilterRowComplete,
  newDataFilterRow,
  operatorTakesValue,
  rowToDataFilter,
  ruleSummary,
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
  definitions.find((definition) => definition.name === activityType)?.data_schema?.fields ?? []

function DataConditionRow({
  activityType,
  index,
  row,
  schemaFields,
  onChange,
  onRemove,
}: {
  activityType: string
  index: number
  row: DataFilterRow
  schemaFields: DataFieldDefinition[]
  onChange: (row: DataFilterRow) => void
  onRemove: () => void
}) {
  const listId = `autoshare-known-values-${index}`
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
      {operatorTakesValue(row.operator) && (
        <input
          type="text"
          aria-label="Value"
          placeholder="Value"
          list={offerValues ? listId : undefined}
          value={row.value}
          onInput={(e) => onChange({ ...row, value: (e.target as HTMLInputElement).value })}
        />
      )}
      {offerValues && <KnownValues id={listId} activityType={activityType} field={row.field} />}
      <button type="button" class="btn-secondary" onClick={onRemove} title="Remove condition">
        Remove
      </button>
    </div>
  )
}

function RuleRow({ rule, postCount }: { rule: AutoshareRule; postCount: number }) {
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
    <li class="autoshare-rule-row">
      <div class="autoshare-rule-main">
        <span class="autoshare-rule-name">{rule.name}</span>
        <span class="autoshare-rule-meta">
          {ruleSummary(rule, labelFor)}
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
        <button
          type="button"
          class="btn-danger"
          onClick={() => window.confirm(`Delete "${rule.name}"?`) && del.mutate()}
          disabled={del.isPending}
        >
          Delete
        </button>
      </div>
    </li>
  )
}

// eslint-disable-next-line complexity -- one form, one field per predicate/template knob
function CreateRuleForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [activityType, setActivityType] = useState('')
  const [minMinutes, setMinMinutes] = useState('')
  const [minKm, setMinKm] = useState('')
  const [summary, setSummary] = useState<Set<string>>(() => new Set(DEFAULT_SUMMARY))
  const [series, setSeries] = useState<Set<MetricType>>(() => new Set())
  const [includeMap, setIncludeMap] = useState(false)
  const [visibility, setVisibility] = useState<FeedVisibility>('followers')
  const [message, setMessage] = useState('')
  const [conditions, setConditions] = useState<DataFilterRow[]>([])
  const [preview, setPreview] = useState<{ would_match: number; sample_days: number } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const schemaFields = schemaFieldsOf(useActivityTypeDefinitions(), activityType)
  const updateCondition = (index: number, row: DataFilterRow) =>
    setConditions((rows) => rows.map((current, i) => (i === index ? row : current)))
  const conditionsComplete = conditions.every(dataFilterRowComplete)

  const body = (): AddAutoshareRuleBody => ({
    activity_types: activityType ? [activityType] : [],
    data_filters: conditions.map(rowToDataFilter),
    name: name.trim() || 'Unnamed rule',
    include_chart: series.has('heart_rate'),
    include_map: includeMap,
    included_metrics: SUMMARY_METRICS.map((m) => m.key).filter((k) => summary.has(k)),
    ...(message.trim() === '' ? {} : { message: message.trim() }),
    ...(minKm.trim() === '' ? {} : { min_distance_meters: Number(minKm) * 1000 }),
    ...(minMinutes.trim() === '' ? {} : { min_duration_seconds: Number(minMinutes) * 60 }),
    series_metrics: SERIES_METRICS.map((m) => m.key).filter((k) => series.has(k)),
    visibility,
  })

  const previewMutation = useMutation({
    mutationFn: () => previewAutoshareRule(body()),
    onError: (err) => {
      setPreview(null)
      setPreviewError(err.message)
    },
    onSuccess: (result) => {
      setPreviewError(null)
      setPreview({ sample_days: result.sample_days ?? 30, would_match: result.would_match ?? 0 })
    },
  })
  const createMutation = useMutation({
    mutationFn: () => addAutoshareRule(body()),
    onError: () => alert('Failed to create the rule.'),
    onSuccess: onDone,
  })

  const canSubmit = name.trim() !== '' && summary.size > 0 && conditionsComplete && !createMutation.isPending

  return (
    <form
      class="autoshare-create"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) createMutation.mutate()
      }}
    >
      <label>
        Name
        <input
          type="text"
          value={name}
          placeholder="e.g. Runs longer than 15 minutes"
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </label>

      <div class="autoshare-create-row">
        <label>
          Activity type (empty = any)
          <ActivityTypePicker value={activityType} onChange={setActivityType} />
        </label>
        <label>
          Min duration (minutes)
          <input
            type="number"
            min="1"
            value={minMinutes}
            onInput={(e) => setMinMinutes((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Min distance (km)
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={minKm}
            onInput={(e) => setMinKm((e.target as HTMLInputElement).value)}
          />
        </label>
      </div>

      <fieldset class="share-dialog-group">
        <legend>Data conditions (all must hold)</legend>
        {conditions.map((row, index) => (
          <DataConditionRow
            key={index}
            activityType={activityType}
            index={index}
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
                onChange={() => setSummary((s) => toggleKey(s, key))}
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
                onChange={() => setSeries((s) => toggleKey(s, key))}
              />
              {label}
            </label>
          ))}
          <label class="share-dialog-checkbox">
            <input
              type="checkbox"
              checked={includeMap}
              onChange={(e) => setIncludeMap((e.target as HTMLInputElement).checked)}
            />
            Route map
          </label>
        </div>
      </fieldset>

      <label>
        Fixed message on auto-created posts (optional)
        <input
          type="text"
          maxLength={feedPostMessageMaxLength}
          value={message}
          onInput={(e) => setMessage((e.target as HTMLInputElement).value)}
        />
      </label>

      <VisibilitySelector
        name="autoshare-visibility"
        options={FEED_VISIBILITY_OPTIONS}
        value={visibility}
        onChange={setVisibility}
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
          Create (starts off)
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
        <CreateRuleForm
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
