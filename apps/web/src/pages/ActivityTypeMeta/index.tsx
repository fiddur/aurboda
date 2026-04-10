/**
 * Activity type meta page — overview of an activity type (e.g. "coffee", "strength_training").
 * Shows icon, display_name, category badge, trend chart, recent occurrences, and related links.
 */
import type { DataFieldDefinition, DataSchemaDefinition } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useRoute } from 'preact-iso'
import { useCallback, useState } from 'preact/hooks'

import { IconInput } from '../../components/IconInput'
import { IconPreview } from '../../components/IconPreview'
import { MiniTrendChart } from '../../components/MiniTrendChart'
import { SaveCancelRow } from '../../components/SaveCancelRow'
import { useSaveStatus } from '../../components/SaveStatusIndicator'
import {
  fetchActivities,
  fetchActivityTypeDefinitions,
  fetchTrend,
  mergeActivityTypeApi,
  renameActivityType,
  updateActivityTypeDefinition,
  type ActivityTypeDefinition,
  type FetchTrendParams,
} from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import { suggestEmoji } from '../../utils/emojiLookup'
import { formatDateTime, formatDuration } from '../EntityDetail/format-utils'
import './style.css'

const LOOKBACK_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '180 days', value: 180 },
  { label: '1 year', value: 365 },
  { label: '2 years', value: 730 },
  { label: 'All time', value: 3650 },
]

const DURATION_CATEGORIES = new Set(['exercise', 'sleep_rest'])

function ActivityTypeTrendSection({
  name,
  isDuration,
  lookback,
}: {
  name: string
  isDuration: boolean
  lookback: number
}) {
  const trendParams: FetchTrendParams = {
    aggregation: isDuration ? 'sum' : 'count',
    display_period: 'weekly',
    half_life_days: 15,
    lookback_days: lookback,
    pattern: name,
    source_type: 'activity_type',
  }

  const trendQuery = useQuery({
    queryFn: () => fetchTrend(trendParams),
    queryKey: ['trend', trendParams],
    staleTime: 5 * 60 * 1000,
  })

  if (trendQuery.isLoading) return <p class="loading">Loading trend...</p>
  if (trendQuery.error) return <p class="error">Failed to load trend data</p>
  if (!trendQuery.data) return null

  const chartUrl = `/chart?source_type=activity_type&pattern=${encodeURIComponent(name)}&lookback_days=${lookback}&aggregation=${isDuration ? 'sum' : 'count'}`

  return (
    <>
      <div class="activity-type-meta-trend-value">
        <span class="activity-type-meta-trend-number">{trendQuery.data.current_value.toFixed(1)}</span>
        <span class="activity-type-meta-trend-unit">{trendQuery.data.display_unit}</span>
      </div>
      <a href={chartUrl} style={{ display: 'block' }}>
        <MiniTrendChart data={trendQuery.data.history} color={isDuration ? '#f97316' : '#8b5cf6'} />
      </a>
    </>
  )
}

function SettingsSection({
  name,
  currentIcon,
  currentDisplayName,
  showOnTimeline,
}: {
  name: string
  currentIcon: string
  currentDisplayName: string
  showOnTimeline: boolean
}) {
  const queryClient = useQueryClient()
  const [iconValue, setIconValue] = useState<string | undefined>(undefined)
  const [displayNameValue, setDisplayNameValue] = useState<string | undefined>(undefined)
  const [saveStatus, setSaveStatus] = useSaveStatus(3000)

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates: Record<string, string> = {}
      if (iconValue !== undefined && iconValue !== currentIcon) updates.icon = iconValue
      if (displayNameValue !== undefined && displayNameValue !== currentDisplayName) {
        updates.display_name = displayNameValue
      }
      await updateActivityTypeDefinition(name, updates)
    },
    onError: () => setSaveStatus({ status: 'error' }),
    onSuccess: () => {
      setSaveStatus({ status: 'saved' })
      queryClient.invalidateQueries({ queryKey: ['activity-type-definitions'] })
      queryClient.invalidateQueries({ queryKey: ['activityTypeDefinitions'] })
      queryClient.invalidateQueries({ queryKey: ['item-icons'] })
      setIconValue(undefined)
      setDisplayNameValue(undefined)
    },
  })

  const timelineToggleMutation = useMutation({
    mutationFn: () => updateActivityTypeDefinition(name, { show_on_timeline: !showOnTimeline }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['activity-type-definitions'] })
      const previous = queryClient.getQueryData<ActivityTypeDefinition[]>(['activity-type-definitions'])
      queryClient.setQueryData<ActivityTypeDefinition[]>(['activity-type-definitions'], (old) =>
        old?.map((t) => (t.name === name ? { ...t, show_on_timeline: !showOnTimeline } : t)),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['activity-type-definitions'], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['activity-type-definitions'] })
      queryClient.invalidateQueries({ queryKey: ['activityTypeDefinitions'] })
    },
  })

  const suggested = suggestEmoji(name)
  const shownIcon = iconValue ?? currentIcon
  const shownDisplayName = displayNameValue ?? currentDisplayName

  const hasChanges =
    (iconValue !== undefined && iconValue !== currentIcon) ||
    (displayNameValue !== undefined && displayNameValue !== currentDisplayName)

  return (
    <section class="activity-type-meta-section">
      <h2>Settings</h2>
      <div class="activity-type-meta-settings-grid">
        <label>
          <span class="activity-type-meta-field-label">Display Name</span>
          <input
            type="text"
            class="activity-type-meta-text-input"
            value={shownDisplayName}
            onInput={(e) => setDisplayNameValue((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          <span class="activity-type-meta-field-label">Icon</span>
          <div class="activity-type-meta-icon-row">
            <IconInput
              value={shownIcon}
              onChange={setIconValue}
              suggestedEmoji={suggested}
              previewClass="activity-type-meta-icon-preview"
            />
          </div>
        </label>
      </div>
      <label class="activity-type-meta-timeline-toggle">
        <input
          type="checkbox"
          checked={showOnTimeline}
          onChange={() => timelineToggleMutation.mutate()}
          disabled={timelineToggleMutation.isPending}
        />
        <span>Show on timeline</span>
      </label>
      {hasChanges && (
        <SaveCancelRow
          onSave={() => {
            setSaveStatus({ status: 'saving' })
            saveMutation.mutate()
          }}
          onCancel={() => {
            setIconValue(undefined)
            setDisplayNameValue(undefined)
          }}
          isPending={saveMutation.isPending}
          saveStatus={saveStatus}
          saveStatusVariant="compact"
        />
      )}
    </section>
  )
}

function RecentOccurrences({ name }: { name: string }) {
  const recentStart = new Date()
  recentStart.setDate(recentStart.getDate() - 30)

  const { data: activities, isLoading } = useQuery({
    queryFn: () => fetchActivities(recentStart, new Date(), [name]),
    queryKey: ['recent-activities', name],
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) return <p class="loading">Loading...</p>
  if (!activities || activities.length === 0) {
    return <p class="activity-type-meta-empty">No occurrences in the last 30 days</p>
  }

  const recent = activities.slice(-10).reverse()

  return (
    <div class="activity-type-meta-recent-list">
      {recent.map((activity) => (
        <a key={activity.id} href={`/detail/activity/${activity.id}`} class="activity-type-meta-recent-item">
          <span class="activity-type-meta-recent-time">{formatDateTime(activity.start_time)}</span>
          {activity.title && <span class="activity-type-meta-recent-title">{activity.title}</span>}
          {activity.end_time && (
            <span class="activity-type-meta-recent-duration">
              {formatDuration(activity.start_time, activity.end_time)}
            </span>
          )}
        </a>
      ))}
      {activities.length > 10 && (
        <p class="activity-type-meta-empty">+{activities.length - 10} more in last 30 days</p>
      )}
    </div>
  )
}

function RenameSection({ name }: { name: string }) {
  const queryClient = useQueryClient()
  const { route } = useLocation()
  const [showRename, setShowRename] = useState(false)
  const [newName, setNewName] = useState(name)
  const [error, setError] = useState('')

  const renameMutation = useMutation({
    mutationFn: () => renameActivityType(name, newName),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Rename failed')
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['activity-type-definitions'] })
      queryClient.invalidateQueries({ queryKey: ['activityTypeDefinitions'] })
      queryClient.invalidateQueries({ queryKey: ['recent-activities'] })
      route(`/activity-type/${encodeURIComponent(newName)}`)
      alert(
        `Renamed to "${newName}"` +
          (result.activities_updated ? ` (${result.activities_updated} activities updated)` : ''),
      )
    },
  })

  const valid = /^[a-z][a-z0-9_]*$/.test(newName) && newName !== name

  if (!showRename) {
    return (
      <section class="activity-type-meta-section">
        <h2>Rename</h2>
        <p class="activity-type-meta-merge-desc">
          Change the snake_case identifier for this activity type. All activities and deduction rules will be
          updated.
        </p>
        <button type="button" class="btn-secondary" onClick={() => setShowRename(true)}>
          Rename...
        </button>
      </section>
    )
  }

  return (
    <section class="activity-type-meta-section">
      <h2>Rename</h2>
      <div class="activity-type-meta-merge-form">
        <label>
          <span class="activity-type-meta-field-label">
            Current: <code>{name}</code>
          </span>
          <input
            type="text"
            value={newName}
            onInput={(e) => {
              setNewName((e.target as HTMLInputElement).value)
              setError('')
            }}
            placeholder="new_snake_name"
          />
        </label>
        {error && <p class="error">{error}</p>}
        <div class="activity-type-meta-merge-actions">
          <button
            type="button"
            class="btn-primary"
            disabled={!valid || renameMutation.isPending}
            onClick={() => renameMutation.mutate()}
          >
            {renameMutation.isPending ? 'Renaming...' : 'Rename'}
          </button>
          <button type="button" class="btn-secondary" onClick={() => setShowRename(false)}>
            Cancel
          </button>
        </div>
      </div>
    </section>
  )
}

function MergeActivityTypeSection({
  name,
  definitions,
}: {
  name: string
  definitions: ActivityTypeDefinition[]
}) {
  const queryClient = useQueryClient()
  const { route } = useLocation()
  const [showMerge, setShowMerge] = useState(false)
  const [target, setTarget] = useState('')
  const [confirmText, setConfirmText] = useState('')

  const mergeMutation = useMutation({
    mutationFn: () => mergeActivityTypeApi(name, target),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['activity-type-definitions'] })
      queryClient.invalidateQueries({ queryKey: ['activityTypeDefinitions'] })
      queryClient.invalidateQueries({ queryKey: ['recent-activities'] })
      route(`/activity-type/${encodeURIComponent(target)}`)
      alert(
        `Merged ${result.activities_reassigned ?? 0} activities into "${target}"` +
          (result.deduction_rules_updated
            ? ` (${result.deduction_rules_updated} deduction rules updated)`
            : ''),
      )
    },
  })

  const options = definitions
    .filter((d) => d.name !== name)
    .map((d) => ({ label: d.display_name, value: d.name }))
    .sort((a, b) => a.label.localeCompare(b.label))

  if (!showMerge) {
    return (
      <section class="activity-type-meta-section">
        <h2>Merge</h2>
        <p class="activity-type-meta-merge-desc">
          Merge all activities from this custom type into another type, then delete this definition.
        </p>
        <button type="button" class="btn-secondary" onClick={() => setShowMerge(true)}>
          Merge into...
        </button>
      </section>
    )
  }

  const ready = target && confirmText === name

  return (
    <section class="activity-type-meta-section">
      <h2>Merge</h2>
      <div class="activity-type-meta-merge-form">
        <label>
          <span class="activity-type-meta-field-label">Target activity type</span>
          <select value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}>
            <option value="">Select target...</option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {target && (
          <label>
            <span class="activity-type-meta-field-label">
              Type <code>{name}</code> to confirm
            </span>
            <input
              type="text"
              value={confirmText}
              onInput={(e) => setConfirmText((e.target as HTMLInputElement).value)}
              placeholder={name}
            />
          </label>
        )}
        <div class="activity-type-meta-merge-actions">
          <button
            type="button"
            class="btn-danger"
            disabled={!ready || mergeMutation.isPending}
            onClick={() => mergeMutation.mutate()}
          >
            {mergeMutation.isPending ? 'Merging...' : `Merge into ${target}`}
          </button>
          <button type="button" class="btn-secondary" onClick={() => setShowMerge(false)}>
            Cancel
          </button>
        </div>
        {mergeMutation.error && <p class="error">Merge failed. Please try again.</p>}
      </div>
    </section>
  )
}

const FIELD_TYPES = ['string', 'number', 'boolean'] as const

const emptyField = (): DataFieldDefinition => ({ name: '', type: 'string' })

function DataSchemaSection({
  name,
  dataSchema,
}: {
  name: string
  dataSchema: DataSchemaDefinition | undefined
}) {
  const queryClient = useQueryClient()
  const [fields, setFields] = useState<DataFieldDefinition[]>(dataSchema?.fields ?? [])
  const [saveStatus, setSaveStatus] = useSaveStatus(3000)

  // Reset local state when upstream changes
  const currentJson = JSON.stringify(dataSchema?.fields ?? [])
  const [lastSyncedJson, setLastSyncedJson] = useState(currentJson)
  if (currentJson !== lastSyncedJson) {
    setFields(dataSchema?.fields ?? [])
    setLastSyncedJson(currentJson)
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const validFields = fields.filter((f) => /^[a-z][a-z0-9_]*$/.test(f.name))
      const schema: DataSchemaDefinition | null = validFields.length > 0 ? { fields: validFields } : null
      await updateActivityTypeDefinition(name, { data_schema: schema })
    },
    onError: () => setSaveStatus({ status: 'error' }),
    onSuccess: () => {
      setSaveStatus({ status: 'saved' })
      queryClient.invalidateQueries({ queryKey: ['activity-type-definitions'] })
      queryClient.invalidateQueries({ queryKey: ['activityTypeDefinitions'] })
    },
  })

  const updateField = useCallback((index: number, patch: Partial<DataFieldDefinition>) => {
    setFields((prev) => prev.map((f, i) => (i === index ? ({ ...f, ...patch } as DataFieldDefinition) : f)))
  }, [])

  const removeField = useCallback((index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const hasChanges = JSON.stringify(fields) !== currentJson

  return (
    <section class="activity-type-meta-section">
      <h2>Data Schema</h2>
      {fields.length === 0 ? (
        <p class="activity-type-meta-empty">
          No data schema defined. Add fields to validate and display custom data.
        </p>
      ) : (
        <table class="activity-type-meta-schema-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Label</th>
              <th>Required</th>
              <th title="Suitable for chart breakdowns by distinct values (e.g. device names, locations). Not for continuous numbers.">
                Categorical
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fields.map((field, i) => (
              <tr key={i}>
                <td>
                  <input
                    type="text"
                    class="activity-type-meta-schema-input"
                    value={field.name}
                    placeholder="field_name"
                    onInput={(e) => updateField(i, { name: (e.target as HTMLInputElement).value })}
                  />
                </td>
                <td>
                  <select
                    class="activity-type-meta-schema-input"
                    value={field.type}
                    onChange={(e) =>
                      updateField(i, {
                        type: (e.target as HTMLSelectElement).value as DataFieldDefinition['type'],
                      })
                    }
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    class="activity-type-meta-schema-input"
                    value={field.label ?? ''}
                    placeholder="Display label"
                    onInput={(e) =>
                      updateField(i, { label: (e.target as HTMLInputElement).value || undefined })
                    }
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={field.required ?? false}
                    onChange={() => updateField(i, { required: !field.required || undefined })}
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={field.is_categorical ?? false}
                    onChange={() => updateField(i, { is_categorical: !field.is_categorical || undefined })}
                  />
                </td>
                <td>
                  <button type="button" class="btn-icon-small" onClick={() => removeField(i)}>
                    x
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button
        type="button"
        class="btn-secondary"
        style={{ marginTop: '0.5rem' }}
        onClick={() => setFields((prev) => [...prev, emptyField()])}
      >
        + Add Field
      </button>
      {hasChanges && (
        <SaveCancelRow
          onSave={() => {
            setSaveStatus({ status: 'saving' })
            saveMutation.mutate()
          }}
          onCancel={() => setFields(dataSchema?.fields ?? [])}
          isPending={saveMutation.isPending}
          saveStatus={saveStatus}
          saveStatusVariant="compact"
        />
      )}
    </section>
  )
}

function resolveTypeDef(typeDef: ActivityTypeDefinition | undefined, name: string) {
  const displayName = typeDef?.display_name ?? toDisplayName(name)
  const icon = typeDef?.icon ?? ''
  const color = typeDef?.color ?? '#6b7280'
  const category = typeDef?.display_category ?? 'other'
  const showOnTimeline = typeDef?.show_on_timeline ?? true
  const isDuration = DURATION_CATEGORIES.has(category)
  return { displayName, icon, color, category, showOnTimeline, isDuration }
}

function ActivityTypeHeader({
  name,
  displayName,
  icon,
  color,
  category,
}: {
  name: string
  displayName: string
  icon: string
  color: string
  category: string
}) {
  return (
    <div class="activity-type-meta-header">
      <div class="activity-type-meta-title-row">
        {icon ? (
          <IconPreview icon={icon} size={32} />
        ) : (
          <span class="activity-type-meta-icon-placeholder">?</span>
        )}
        <h1>{displayName}</h1>
      </div>
      <div class="activity-type-meta-badges">
        <span class="activity-type-meta-category-badge">{toDisplayName(category)}</span>
        <span class="activity-type-meta-color-dot" style={{ background: color }} />
        {name !== displayName && <span class="activity-type-meta-name-muted">{name}</span>}
      </div>
    </div>
  )
}

export function ActivityTypeMeta() {
  const { params } = useRoute()
  const name = decodeURIComponent(params.name as string)
  const [lookback, setLookback] = useState(90)

  const { data: definitions } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activity-type-definitions'],
    staleTime: 5 * 60 * 1000,
  })

  const typeDef = definitions?.find((d) => d.name === name)
  const { displayName, icon, color, category, showOnTimeline, isDuration } = resolveTypeDef(typeDef, name)

  return (
    <div class="activity-type-meta-page">
      <ActivityTypeHeader
        name={name}
        displayName={displayName}
        icon={icon}
        color={color}
        category={category}
      />

      <SettingsSection
        name={name}
        currentIcon={icon}
        currentDisplayName={displayName}
        showOnTimeline={showOnTimeline}
      />

      <DataSchemaSection name={name} dataSchema={typeDef?.data_schema} />

      <section class="activity-type-meta-section">
        <div class="activity-type-meta-section-header">
          <h2>Trend</h2>
          <select
            value={lookback}
            onChange={(e) => setLookback(Number((e.target as HTMLSelectElement).value))}
          >
            {LOOKBACK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <ActivityTypeTrendSection name={name} isDuration={isDuration} lookback={lookback} />
      </section>

      <section class="activity-type-meta-section">
        <h2>Recent Occurrences</h2>
        <RecentOccurrences name={name} />
      </section>

      {/* Rename & Merge (custom types only) */}
      {typeDef && !typeDef.is_builtin && (
        <>
          <RenameSection name={name} />
          {definitions && <MergeActivityTypeSection name={name} definitions={definitions} />}
        </>
      )}

      <section class="activity-type-meta-section">
        <h2>Related</h2>
        <div class="activity-type-meta-links">
          <a
            href={`/chart?source_type=activity_type&pattern=${encodeURIComponent(name)}`}
            class="activity-type-meta-link"
          >
            Chart Explorer
          </a>
          <a href="/correlations" class="activity-type-meta-link">
            Correlations
          </a>
          <a href="/timeline" class="activity-type-meta-link">
            Timeline
          </a>
        </div>
      </section>
    </div>
  )
}
