/**
 * Activity type meta page — overview of an activity type (e.g. "Coffee").
 * Shows icon, display name, trend chart, and occurrence count.
 *
 * Accepts both `/tag/:tagKey` (legacy) and `/tag/:definitionId` (UUID) routes.
 */
import type { TagDefinition } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import {
  fetchActivityTypeDefinitions,
  fetchItemIcons,
  fetchTagDefinitionById,
  fetchTrend,
  type ActivityTypeDefinition,
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
  typeDef,
  shownIcon,
  shownName,
}: {
  definition?: TagDefinition
  typeDef?: ActivityTypeDefinition
  shownIcon: string
  shownName: string
}) {
  const count = definition?.count

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
        </div>
      )}
      {typeDef && (
        <div class="tag-meta-stats">
          <span class="tag-meta-stat">Category: {typeDef.display_category}</span>
          {typeDef.is_builtin && <span class="tag-meta-stat">Built-in</span>}
        </div>
      )}
    </div>
  )
}

const findTypeDef = (
  defs: ActivityTypeDefinition[] | undefined,
  key: string,
): ActivityTypeDefinition | undefined => defs?.find((d) => d.name === key || d.display_name === key)

const resolveDisplayName = (
  definition: TagDefinition | undefined,
  typeDef: ActivityTypeDefinition | undefined,
  fallback: string,
): string => definition?.name ?? typeDef?.display_name ?? typeDef?.name ?? fallback

const resolveDisplayIcon = (
  definition: TagDefinition | undefined,
  typeDef: ActivityTypeDefinition | undefined,
  icons: Record<string, string>,
  name: string,
  key: string,
): string => definition?.icon ?? typeDef?.icon ?? icons[name] ?? icons[key] ?? ''

/** Resolve activity type identity from URL param (UUID for definition, or type name). */
function useTypeResolution(rawParam: string) {
  const isUuid = UUID_RE.test(rawParam)

  const { data: definition } = useQuery({
    enabled: isUuid,
    queryFn: () => fetchTagDefinitionById(rawParam),
    queryKey: ['tag-definition', rawParam],
    staleTime: 5 * 60 * 1000,
  })

  const { data: activityTypeDefs } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activity-type-definitions'],
    staleTime: 5 * 60 * 1000,
  })

  const { data: icons = {} } = useQuery({
    queryFn: fetchItemIcons,
    queryKey: ['item-icons'],
    staleTime: 30 * 60 * 1000,
  })

  const definitionId = isUuid ? rawParam : undefined
  const effectiveKey = definition?.name ?? rawParam
  const typeDef = findTypeDef(activityTypeDefs, effectiveKey)
  const currentName = resolveDisplayName(definition, typeDef, rawParam)
  const currentIcon = resolveDisplayIcon(definition, typeDef, icons, currentName, effectiveKey)

  return { currentIcon, currentName, definition, definitionId, effectiveTagKey: effectiveKey, typeDef }
}

export function TagMeta() {
  const { params } = useRoute()
  const rawParam = decodeURIComponent(params.tagKey as string)
  const [lookback, setLookback] = useState(90)
  const { currentIcon, currentName, definition, definitionId, effectiveTagKey, typeDef } =
    useTypeResolution(rawParam)

  return (
    <div class="tag-meta-page">
      <TagHeader definition={definition} typeDef={typeDef} shownIcon={currentIcon} shownName={currentName} />

      <TagSettingsSection
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
        </div>
      </section>
    </div>
  )
}
