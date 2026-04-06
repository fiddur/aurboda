/**
 * Tag meta page — overview of a tag type (e.g. "Coffee").
 * Shows icon, display name, trend chart, occurrence count, inline settings, and merge UI.
 *
 * Accepts both `/tag/:tagKey` (legacy) and `/tag/:definitionId` (UUID) routes.
 */
import type { ProgrammaticTag, TagDefinition } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import {
  fetchActivityTypeDefinitions,
  fetchTagDefinitionById,
  fetchTagMappings,
  fetchTrend,
  type FetchTrendParams,
} from '../../state/api'
import { MiniTrendChart } from './MiniTrendChart'
import { TagIconPreview } from './TagIconPreview'
import { TagSettingsSection } from './TagSettingsSection'
import './style.css'

const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

const LOOKBACK_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '180 days', value: 180 },
  { label: '1 year', value: 365 },
  { label: '2 years', value: 730 },
  { label: 'All time', value: 3650 },
]

function TagTrendSection({
  definitionId,
  tagKey,
  lookback,
}: {
  definitionId?: string
  tagKey: string
  lookback: number
}) {
  const trendParams: FetchTrendParams = {
    display_period: 'monthly',
    half_life_days: 15,
    lookback_days: lookback,
    pattern: definitionId ? '' : tagKey,
    source_type: 'tag',
    tag_definition_id: definitionId,
  }

  const trendQuery = useQuery({
    queryFn: () => fetchTrend(trendParams),
    queryKey: ['trend', trendParams],
    staleTime: 5 * 60 * 1000,
  })

  if (trendQuery.isLoading) return <p class="loading">Loading trend...</p>
  if (trendQuery.error) return <p class="error">Failed to load trend data</p>
  if (!trendQuery.data) return null

  const chartUrl = definitionId
    ? `/chart?source_type=tag&tag_definition_id=${definitionId}&lookback_days=${lookback}`
    : `/chart?source_type=tag&pattern=${encodeURIComponent(tagKey)}&lookback_days=${lookback}`

  return (
    <>
      <div class="tag-meta-trend-value">
        <span class="tag-meta-trend-number">{trendQuery.data.current_value.toFixed(1)}</span>
        <span class="tag-meta-trend-unit">{trendQuery.data.display_unit}</span>
      </div>
      <a href={chartUrl} style={{ display: 'block' }}>
        <MiniTrendChart data={trendQuery.data.history} color="#8b5cf6" />
      </a>
    </>
  )
}

function TagHeader({
  definition,
  tagInfo,
  shownIcon,
  shownName,
}: {
  definition?: TagDefinition
  tagInfo: ProgrammaticTag | undefined
  shownIcon: string
  shownName: string
}) {
  const count = definition?.count ?? tagInfo?.count
  const latestTime = definition?.latest_time ?? tagInfo?.latest_time

  return (
    <div class="tag-meta-header">
      <div class="tag-meta-title-row">
        {shownIcon ? <TagIconPreview icon={shownIcon} /> : <span class="tag-meta-icon-placeholder">?</span>}
        <h1>{shownName}</h1>
      </div>
      {count !== undefined && (
        <div class="tag-meta-stats">
          <span class="tag-meta-stat">
            <strong>{count}</strong> occurrence{count !== 1 ? 's' : ''}
          </span>
          {latestTime && <span class="tag-meta-stat">Last: {new Date(latestTime).toLocaleDateString()}</span>}
        </div>
      )}
      {definition?.aliases && definition.aliases.length > 0 && (
        <div class="tag-meta-stats">
          <span class="tag-meta-stat">Aliases: {definition.aliases.join(', ')}</span>
        </div>
      )}
    </div>
  )
}

// Merge section removed — activity type definitions don't support merge
function MergeSection(_props: { definitionId: string }) {
  return null
}

/** Find the programmatic tag matching either a definition or a raw param. */
const findTagInfo = (
  tags: ProgrammaticTag[] | undefined,
  definition: TagDefinition | undefined,
  rawParam: string,
  isUuid: boolean,
): ProgrammaticTag | undefined => {
  if (isUuid) {
    return tags?.find(
      (t) => definition && (t.tag_key === definition.name || t.current_name === definition.name),
    )
  }
  return tags?.find((t) => t.tag_key === rawParam || t.current_name === rawParam)
}

/** Resolve the canonical display name from available sources. */
const resolveName = (
  definition: TagDefinition | undefined,
  tagInfo: ProgrammaticTag | undefined,
  mappings: Record<string, string>,
  rawParam: string,
): string => definition?.name ?? tagInfo?.current_name ?? mappings[rawParam] ?? rawParam

/** Resolve the icon from available sources. */
const resolveIcon = (
  definition: TagDefinition | undefined,
  icons: Record<string, string>,
  name: string,
  tagKey: string,
): string => definition?.icon ?? icons[name] ?? icons[tagKey] ?? ''

/** Resolve tag identity from URL param (UUID for definition, or tag name key). */
function useTagResolution(rawParam: string) {
  const isUuid = UUID_RE.test(rawParam)

  const { data: definition } = useQuery({
    enabled: isUuid,
    queryFn: () => fetchTagDefinitionById(rawParam),
    queryKey: ['tag-definition', rawParam],
    staleTime: 5 * 60 * 1000,
  })

  // Use activity type definitions instead of programmatic tags
  const { data: activityTypeDefs } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activity-type-definitions'],
    staleTime: 5 * 60 * 1000,
  })

  // Convert activity type definitions to ProgrammaticTag shape for compatibility
  const tags: ProgrammaticTag[] | undefined = activityTypeDefs?.map((d) => ({
    count: 0,
    current_name: d.display_name || d.name,
    is_programmatic: !d.is_builtin,
    latest_time: new Date().toISOString(),
    tag_key: d.name,
  }))

  const { data: mappingsData } = useQuery({
    queryFn: fetchTagMappings,
    queryKey: ['tag-mappings'],
    staleTime: 30 * 60 * 1000,
  })

  const tagInfo = findTagInfo(tags, definition, rawParam, isUuid)
  const mappings = mappingsData?.mappings ?? {}
  const icons = mappingsData?.icons ?? {}
  const definitionId = isUuid ? rawParam : undefined
  const effectiveTagKey = definition?.name ?? tagInfo?.tag_key ?? rawParam
  const currentName = resolveName(definition, tagInfo, mappings, rawParam)
  const currentIcon = resolveIcon(definition, icons, currentName, effectiveTagKey)

  return { currentIcon, currentName, definition, definitionId, effectiveTagKey, tagInfo }
}

export function TagMeta() {
  const { params } = useRoute()
  const rawParam = decodeURIComponent(params.tagKey as string)
  const [lookback, setLookback] = useState(90)
  const { currentIcon, currentName, definition, definitionId, effectiveTagKey, tagInfo } =
    useTagResolution(rawParam)

  return (
    <div class="tag-meta-page">
      <TagHeader definition={definition} tagInfo={tagInfo} shownIcon={currentIcon} shownName={currentName} />

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
        <TagTrendSection definitionId={definitionId} tagKey={effectiveTagKey} lookback={lookback} />
      </section>

      {/* Merge section — only when viewing by definition */}
      {definitionId && <MergeSection definitionId={definitionId} />}

      {/* Quick links */}
      <section class="tag-meta-section">
        <h2>Related</h2>
        <div class="tag-meta-links">
          <a href="/chart" class="tag-meta-link">
            Chart Explorer
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
