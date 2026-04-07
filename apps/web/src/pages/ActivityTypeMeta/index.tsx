/**
 * Activity type meta page — overview of an activity type (e.g. "coffee", "strength_training").
 * Shows icon, display_name, category badge, trend chart, recent occurrences, and related links.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import { IconInput } from '../../components/IconInput'
import { IconPreview } from '../../components/IconPreview'
import { MiniTrendChart } from '../../components/MiniTrendChart'
import { SaveCancelRow } from '../../components/SaveCancelRow'
import { useSaveStatus } from '../../components/SaveStatusIndicator'
import {
  fetchActivities,
  fetchActivityTypeDefinitions,
  fetchTrend,
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

function IconSettingsSection({ name, currentIcon }: { name: string; currentIcon: string }) {
  const queryClient = useQueryClient()
  const [iconValue, setIconValue] = useState<string | undefined>(undefined)
  const [saveStatus, setSaveStatus] = useSaveStatus(3000)

  const saveMutation = useMutation({
    mutationFn: async (icon: string) => {
      await updateActivityTypeDefinition(name, { icon })
    },
    onError: () => setSaveStatus({ status: 'error' }),
    onSuccess: () => {
      setSaveStatus({ status: 'saved' })
      queryClient.invalidateQueries({ queryKey: ['activity-type-definitions'] })
      queryClient.invalidateQueries({ queryKey: ['activityTypeDefinitions'] })
      queryClient.invalidateQueries({ queryKey: ['item-icons'] })
      setIconValue(undefined)
    },
  })

  const suggested = suggestEmoji(name)
  const shownIcon = iconValue ?? currentIcon

  const hasChanges = iconValue !== undefined && iconValue !== currentIcon

  return (
    <section class="activity-type-meta-section">
      <h2>Settings</h2>
      <div class="activity-type-meta-settings-grid">
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
      {hasChanges && (
        <SaveCancelRow
          onSave={() => {
            setSaveStatus({ status: 'saving' })
            saveMutation.mutate(iconValue ?? '')
          }}
          onCancel={() => setIconValue(undefined)}
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

export function ActivityTypeMeta() {
  const { params } = useRoute()
  const name = decodeURIComponent(params.name as string)
  const [lookback, setLookback] = useState(90)

  const { data: definitions } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activity-type-definitions'],
    staleTime: 5 * 60 * 1000,
  })

  const typeDef: ActivityTypeDefinition | undefined = definitions?.find((d) => d.name === name)
  const displayName = typeDef?.display_name ?? toDisplayName(name)
  const icon = typeDef?.icon ?? ''
  const color = typeDef?.color ?? '#6b7280'
  const category = typeDef?.display_category ?? 'other'
  const isDuration = DURATION_CATEGORIES.has(category)

  return (
    <div class="activity-type-meta-page">
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

      <IconSettingsSection name={name} currentIcon={icon} />

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
