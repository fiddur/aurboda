import type { SegmentSort } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation } from 'preact-iso'

import { fetchActivityTypeDefinitions, fetchSegments } from '../../state/api'
import { auth } from '../../state/auth'
import { formatDistance } from '../EntityDetail/format-utils'
import { ActivityTypeName } from '../Routes/ActivityTypeName'
import { formatElapsed, typeDisplayName } from '../Routes/format'
import '../DataSources/style.css'
import '../Routes/style.css'
import { formatEffortCount, searchFromSegmentsQuery, segmentsQueryFromParams } from './format'
import './style.css'

const SORT_LABELS: Record<SegmentSort, string> = {
  last_effort: 'Latest effort',
  efforts: 'Most efforts',
  length: 'Longest',
  alphabetical: 'Name',
}

export function Segments() {
  const { query, route: navigate } = useLocation()
  const segmentsQuery = segmentsQueryFromParams(query)
  const search = searchFromSegmentsQuery(segmentsQuery)
  const enabled = Boolean(auth.value.token)

  const { data: segments = [], isLoading } = useQuery({
    enabled,
    queryFn: () => fetchSegments(segmentsQuery),
    queryKey: search ? ['segments', search] : ['segments'],
  })
  const { data: allSegments = [] } = useQuery({
    enabled,
    queryFn: () => fetchSegments(),
    queryKey: ['segments'],
  })
  const { data: definitions = [] } = useQuery({
    enabled,
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 30 * 60_000,
  })

  if (!auth.value.token) {
    return (
      <div class="data-sources-page">
        <p>Please log in to see your segments.</p>
      </div>
    )
  }

  const typeOptions = [
    ...new Set([
      ...allSegments.map((s) => s.activity_type),
      ...(segmentsQuery.activity_type ? [segmentsQuery.activity_type] : []),
    ]),
  ]
    .map((name) => ({ label: typeDisplayName(name, definitions), name }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const setQuery = (change: Partial<typeof segmentsQuery>) =>
    navigate(`/segments${searchFromSegmentsQuery({ ...segmentsQuery, ...change })}`)

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <h1>Segments</h1>
        <p class="page-subtitle">
          Stretches timed on every pass: a hill, a bridge, a sprint straight. Every activity of the same type
          that covers one gets an effort.
        </p>
        <p class="segments-crosslink">
          Looking for whole courses? See <a href="/routes">Routes</a>.
        </p>
      </div>

      <div class="routes-controls">
        <label>
          Type
          <select
            value={segmentsQuery.activity_type ?? ''}
            onChange={(e) => setQuery({ activity_type: (e.target as HTMLSelectElement).value || undefined })}
          >
            <option value="">All types</option>
            {typeOptions.map((option) => (
              <option key={option.name} value={option.name}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort by
          <select
            value={segmentsQuery.sort ?? 'last_effort'}
            onChange={(e) => setQuery({ sort: (e.target as HTMLSelectElement).value as SegmentSort })}
          >
            {(Object.keys(SORT_LABELS) as SegmentSort[]).map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLoading && <p class="loading">Loading segments...</p>}
      {!isLoading && segments.length === 0 && (
        <p class="routes-empty">
          {segmentsQuery.activity_type
            ? `No ${typeDisplayName(segmentsQuery.activity_type, definitions)} segments.`
            : "No segments yet. A segment is a stretch that is timed on every pass. Create one from an activity's map or from a route."}
        </p>
      )}

      {segments.length > 0 && (
        <div class="routes-list">
          {segments.map((segment) => (
            <a key={segment.id} href={`/segments/${segment.id}`} class="route-row">
              <span class="route-name">{segment.name}</span>
              <span class="route-type">
                <ActivityTypeName name={segment.activity_type} />
              </span>
              <span class="route-length">{formatDistance(segment.length_m)}</span>
              <span class="route-count">{formatEffortCount(segment.effort_count)}</span>
              <span class="route-count">
                Best {segment.best_elapsed_s === null ? '–' : formatElapsed(segment.best_elapsed_s)}
              </span>
              <span class="route-last">
                Last {segment.last_effort_at ? format(new Date(segment.last_effort_at), 'yyyy-MM-dd') : '–'}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
