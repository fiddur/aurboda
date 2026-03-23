/**
 * Exercise type meta page — overview of an exercise type (e.g. "yoga").
 * Shows icon, exercise type name, trend chart (duration over time), and icon settings.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import { IconInput } from '../../components/IconInput'
import { IconPreview } from '../../components/IconPreview'
import { SaveStatusIndicator, useSaveStatus } from '../../components/SaveStatusIndicator'
import { fetchTagMappings, fetchTrend, type FetchTrendParams, updateUserSettings } from '../../state/api'
import { resolveItemIcon } from '../../utils/emojiLookup'
import { MiniTrendChart } from '../TagMeta/MiniTrendChart'
import '../TagMeta/style.css'

const LOOKBACK_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '180 days', value: 180 },
  { label: '1 year', value: 365 },
  { label: '2 years', value: 730 },
  { label: 'All time', value: 3650 },
]

const formatExerciseTypeName = (name: string): string =>
  name.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())

function ExerciseTrendSection({ exerciseType, lookback }: { exerciseType: string; lookback: number }) {
  const trendParams: FetchTrendParams = {
    aggregation: 'sum',
    display_period: 'weekly',
    half_life_days: 15,
    lookback_days: lookback,
    pattern: exerciseType,
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

  return (
    <>
      <div class="tag-meta-trend-value">
        <span class="tag-meta-trend-number">{trendQuery.data.current_value.toFixed(1)}</span>
        <span class="tag-meta-trend-unit">{trendQuery.data.display_unit}</span>
      </div>
      <MiniTrendChart data={trendQuery.data.history} color="#f97316" />
    </>
  )
}

function ExerciseIconSettings({ exerciseType, currentIcon }: { exerciseType: string; currentIcon: string }) {
  const queryClient = useQueryClient()
  const [iconValue, setIconValue] = useState<string | undefined>(undefined)
  const [saveStatus, setSaveStatus] = useSaveStatus(3000)

  const displayName = formatExerciseTypeName(exerciseType)
  const iconKey = `exercise:${displayName}`

  const saveMutation = useMutation({
    mutationFn: async (icon: string) => {
      await updateUserSettings({ item_icons: { [iconKey]: icon } })
    },
    onError: () => setSaveStatus({ status: 'error' }),
    onSuccess: () => {
      setSaveStatus({ status: 'saved' })
      queryClient.invalidateQueries({ queryKey: ['tag-mappings'] })
      queryClient.invalidateQueries({ queryKey: ['userSettings'] })
      setIconValue(undefined)
    },
  })

  const shownIcon = iconValue ?? currentIcon
  const hasChanges = iconValue !== undefined && iconValue !== currentIcon

  return (
    <section class="tag-meta-section">
      <h2>Settings</h2>
      <div class="tag-meta-settings-grid">
        <label>
          <span class="tag-meta-field-label">Icon</span>
          <div class="tag-meta-icon-row">
            <IconInput value={shownIcon} onChange={setIconValue} previewClass="tag-meta-icon-preview" />
          </div>
        </label>
      </div>
      {hasChanges && (
        <div class="tag-meta-save-row">
          <button
            type="button"
            class="btn-primary"
            onClick={() => {
              setSaveStatus({ status: 'saving' })
              saveMutation.mutate(iconValue ?? '')
            }}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>
          <button type="button" class="btn-secondary" onClick={() => setIconValue(undefined)}>
            Cancel
          </button>
          <SaveStatusIndicator state={saveStatus} variant="compact" />
        </div>
      )}
    </section>
  )
}

export function ExerciseMeta() {
  const { params } = useRoute()
  const exerciseType = decodeURIComponent(params.type as string)
  const displayName = formatExerciseTypeName(exerciseType)

  const [lookback, setLookback] = useState(90)

  const { data: mappingsData } = useQuery({
    queryFn: fetchTagMappings,
    queryKey: ['tag-mappings'],
    staleTime: 30 * 60 * 1000,
  })
  const itemIcons = mappingsData?.icons ?? {}
  const icon = resolveItemIcon(`exercise:${displayName}`, itemIcons) ?? ''

  return (
    <div class="tag-meta-page">
      <div class="tag-meta-header">
        <div class="tag-meta-title-row">
          {icon ? <IconPreview icon={icon} /> : <span class="tag-meta-icon-placeholder">?</span>}
          <h1>{displayName}</h1>
        </div>
      </div>

      <ExerciseIconSettings exerciseType={exerciseType} currentIcon={icon} />

      <section class="tag-meta-section">
        <div class="tag-meta-section-header">
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
        <ExerciseTrendSection exerciseType={exerciseType} lookback={lookback} />
      </section>

      <section class="tag-meta-section">
        <h2>Related</h2>
        <div class="tag-meta-links">
          <a href="/trends" class="tag-meta-link">
            All Trends
          </a>
          <a href="/timeline" class="tag-meta-link">
            Timeline
          </a>
          <a href="/hr-zones" class="tag-meta-link">
            HR Zones
          </a>
        </div>
      </section>
    </div>
  )
}
