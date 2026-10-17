import type { RouteSort } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation } from 'preact-iso'

import { fetchActivityTypeDefinitions, fetchRoutes } from '../../state/api'
import { auth } from '../../state/auth'
import { formatDistance } from '../EntityDetail/format-utils'
import { ActivityTypeName } from './ActivityTypeName'
import { routesQueryFromParams, searchFromRoutesQuery, typeDisplayName } from './format'
import './style.css'

const SORT_LABELS: Record<RouteSort, string> = {
  last_run: 'Latest run',
  length: 'Longest',
  name: 'Name',
  runs: 'Most runs',
}

export function Routes() {
  const { query, route: navigate } = useLocation()
  const routesQuery = routesQueryFromParams(query)
  const search = searchFromRoutesQuery(routesQuery)
  const enabled = Boolean(auth.value.token)

  const { data: routes = [], isLoading } = useQuery({
    enabled,
    queryFn: () => fetchRoutes(routesQuery),
    queryKey: search ? ['routes', search] : ['routes'],
  })
  const { data: allRoutes = [] } = useQuery({
    enabled,
    queryFn: () => fetchRoutes(),
    queryKey: ['routes'],
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
        <p>Please log in to see your routes.</p>
      </div>
    )
  }

  const typeOptions = [
    ...new Set([
      ...allRoutes.map((r) => r.activity_type),
      ...(routesQuery.activity_type ? [routesQuery.activity_type] : []),
    ]),
  ]
    .map((name) => ({ label: typeDisplayName(name, definitions), name }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const setQuery = (change: Partial<typeof routesQuery>) =>
    navigate(`/routes${searchFromRoutesQuery({ ...routesQuery, ...change })}`)

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <h1>Routes</h1>
        <p class="page-subtitle">
          Courses you have run more than once, recognised from GPS tracks. A route is the same course in the
          same direction and activity type.
        </p>
      </div>

      <div class="routes-controls">
        <label>
          Type
          <select
            value={routesQuery.activity_type ?? ''}
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
            value={routesQuery.sort ?? 'last_run'}
            onChange={(e) => setQuery({ sort: (e.target as HTMLSelectElement).value as RouteSort })}
          >
            {(Object.keys(SORT_LABELS) as RouteSort[]).map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLoading && <p class="loading">Loading routes...</p>}
      {!isLoading && routes.length === 0 && (
        <p class="routes-empty">
          {routesQuery.activity_type
            ? `No ${typeDisplayName(routesQuery.activity_type, definitions)} routes.`
            : 'No routes yet. One appears when two tracks cover the same course.'}
        </p>
      )}

      {routes.length > 0 && (
        <div class="routes-list">
          {routes.map((route) => (
            <a key={route.id} href={`/routes/${route.id}`} class="route-row">
              <span class="route-name">{route.name}</span>
              <span class="route-type">
                <ActivityTypeName name={route.activity_type} />
              </span>
              <span class="route-length">{formatDistance(route.length_m)}</span>
              <span class="route-count">
                {route.activity_count} {route.activity_count === 1 ? 'run' : 'runs'}
              </span>
              {route.last_activity_at && (
                <span class="route-last">Last {format(new Date(route.last_activity_at), 'yyyy-MM-dd')}</span>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
