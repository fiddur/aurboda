/**
 * Tag meta page — overview of a tag type (e.g. "Coffee").
 * Shows icon, display name, trend chart, occurrence count, and inline settings.
 */
import type { ProgrammaticTag } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import { fetchProgrammaticTags, fetchTagMappings, fetchTrend, type FetchTrendParams } from '../../state/api'
import { MiniTrendChart } from './MiniTrendChart'
import { TagIconPreview } from './TagIconPreview'
import { TagSettingsSection } from './TagSettingsSection'
import './style.css'

const LOOKBACK_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '180 days', value: 180 },
  { label: '1 year', value: 365 },
  { label: '2 years', value: 730 },
  { label: 'All time', value: 3650 },
]

function TagTrendSection({ tagKey, lookback }: { tagKey: string; lookback: number }) {
  const trendParams: FetchTrendParams = {
    display_period: 'monthly',
    half_life_days: 15,
    lookback_days: lookback,
    pattern: tagKey,
    source_type: 'tag',
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
      <MiniTrendChart data={trendQuery.data.history} color="#8b5cf6" />
    </>
  )
}

function TagHeader({
  tagInfo,
  shownIcon,
  shownName,
}: {
  tagInfo: ProgrammaticTag | undefined
  shownIcon: string
  shownName: string
}) {
  return (
    <header class="tag-meta-header">
      <div class="tag-meta-title-row">
        {shownIcon ? <TagIconPreview icon={shownIcon} /> : <span class="tag-meta-icon-placeholder">?</span>}
        <h1>{shownName}</h1>
      </div>
      {tagInfo && (
        <div class="tag-meta-stats">
          <span class="tag-meta-stat">
            <strong>{tagInfo.count}</strong> occurrence{tagInfo.count !== 1 ? 's' : ''}
          </span>
          <span class="tag-meta-stat">Last: {new Date(tagInfo.latest_time).toLocaleDateString()}</span>
        </div>
      )}
    </header>
  )
}

export function TagMeta() {
  const { params } = useRoute()
  const tagKey = decodeURIComponent(params.tagKey as string)

  const [lookback, setLookback] = useState(90)

  // Fetch tag metadata
  const { data: tags } = useQuery({
    queryFn: fetchProgrammaticTags,
    queryKey: ['programmaticTags'],
  })

  const { data: mappingsData } = useQuery({
    queryFn: fetchTagMappings,
    queryKey: ['tag-mappings'],
    staleTime: 30 * 60 * 1000,
  })

  const tagInfo = tags?.find((t) => t.tag_key === tagKey || t.current_name === tagKey)
  const mappings = mappingsData?.mappings ?? {}
  const icons = mappingsData?.icons ?? {}

  // Resolve the effective tag key and display name
  const effectiveTagKey = tagInfo?.tag_key ?? tagKey
  const currentName = tagInfo?.current_name ?? mappings[tagKey] ?? tagKey
  const currentIcon = icons[currentName] ?? icons[effectiveTagKey] ?? ''

  return (
    <div class="tag-meta-page">
      <TagHeader tagInfo={tagInfo} shownIcon={currentIcon} shownName={currentName} />

      <TagSettingsSection
        tagInfo={tagInfo}
        effectiveTagKey={effectiveTagKey}
        currentName={currentName}
        currentIcon={currentIcon}
      />

      {/* Trend section */}
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
        <TagTrendSection tagKey={effectiveTagKey} lookback={lookback} />
      </section>

      {/* Quick links */}
      <section class="tag-meta-section">
        <h2>Related</h2>
        <div class="tag-meta-links">
          <a href="/trends" class="tag-meta-link">
            All Trends
          </a>
          <a href="/correlations" class="tag-meta-link">
            Correlations
          </a>
          <a href="/timeline" class="tag-meta-link">
            Timeline
          </a>
          <a href="/data-sources/aurboda" class="tag-meta-link">
            All Tag Mappings
          </a>
        </div>
      </section>
    </div>
  )
}
