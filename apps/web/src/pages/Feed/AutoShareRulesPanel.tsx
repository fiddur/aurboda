/**
 * Auto-share rules panel (#903): rules that automatically publish settled
 * activities to the federated feed — "share runs longer than 15 minutes".
 *
 * Rules are created DISABLED and the enable toggle states plainly what will
 * leave the instance: enabling is the deliberate act. A preview shows how many
 * activities in the last 30 days would have matched, BEFORE anything is on.
 * Enabling only affects activities that arrive afterwards — never history.
 */
import type { AddAutoshareRuleBody, AutoshareRule, FeedVisibility, MetricType } from '@aurboda/api-spec'

import { feedPostMessageMaxLength } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { ActivityTypePicker } from '../../components/ActivityTypePicker'
import { DEFAULT_SUMMARY, SERIES_METRICS, SUMMARY_METRICS } from '../../components/feed-metrics'
import { FEED_VISIBILITY_OPTIONS, VisibilitySelector } from '../../components/VisibilitySelector'
import {
  addAutoshareRule,
  deleteAutoshareRule,
  listAutoshareRules,
  previewAutoshareRule,
  updateAutoshareRule,
} from '../../state/api'

const toggleKey = <T extends string>(set: Set<T>, key: T): Set<T> => {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/** One human line summarising what a rule matches and publishes. */
const ruleSummary = (rule: AutoshareRule): string => {
  const predicate: string[] = []
  predicate.push(rule.activity_types.length > 0 ? rule.activity_types.join('/') : 'any activity')
  if (rule.min_duration_seconds) predicate.push(`≥ ${Math.round(rule.min_duration_seconds / 60)} min`)
  if (rule.max_duration_seconds) predicate.push(`≤ ${Math.round(rule.max_duration_seconds / 60)} min`)
  if (rule.min_distance_meters) predicate.push(`≥ ${rule.min_distance_meters / 1000} km`)
  if (rule.source) predicate.push(`from ${rule.source}`)
  return `${predicate.join(', ')} → ${rule.visibility}`
}

function RuleRow({ rule, postCount }: { rule: AutoshareRule; postCount: number }) {
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

  const onToggle = () => {
    if (
      rule.enabled ||
      window.confirm(
        `Enable "${rule.name}"?\n\nFrom now on, newly synced activities matching it are ` +
          `AUTOMATICALLY published to your federated feed (${rule.visibility}) with the ` +
          `selected metrics — without asking again. Nothing already synced is shared.`,
      )
    ) {
      toggle.mutate()
    }
  }

  return (
    <li class="autoshare-rule-row">
      <div class="autoshare-rule-main">
        <span class="autoshare-rule-name">{rule.name}</span>
        <span class="autoshare-rule-meta">
          {ruleSummary(rule)}
          {postCount > 0 && ` · ${postCount} post${postCount === 1 ? '' : 's'} auto-shared`}
        </span>
      </div>
      <div class="autoshare-rule-actions">
        <label class="autoshare-rule-toggle">
          <input type="checkbox" checked={rule.enabled} onChange={onToggle} disabled={toggle.isPending} />
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
  const [preview, setPreview] = useState<{ would_match: number; sample_days: number } | null>(null)

  const body = (): AddAutoshareRuleBody => ({
    activity_types: activityType ? [activityType] : [],
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
    onSuccess: (result) =>
      setPreview({ sample_days: result.sample_days ?? 30, would_match: result.would_match ?? 0 }),
  })
  const createMutation = useMutation({
    mutationFn: () => addAutoshareRule(body()),
    onError: () => alert('Failed to create the rule.'),
    onSuccess: onDone,
  })

  const canSubmit = name.trim() !== '' && summary.size > 0 && !createMutation.isPending

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
            min="0"
            step="0.1"
            value={minKm}
            onInput={(e) => setMinKm((e.target as HTMLInputElement).value)}
          />
        </label>
      </div>

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
          disabled={previewMutation.isPending}
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
