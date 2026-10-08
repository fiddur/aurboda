import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'

import { fetchRoutes } from '../../state/api'
import { auth } from '../../state/auth'
import { formatDistance } from '../EntityDetail/format-utils'
import './style.css'

export function Routes() {
  const { data: routes = [], isLoading } = useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: fetchRoutes,
    queryKey: ['routes'],
  })

  if (!auth.value.token) {
    return (
      <div class="data-sources-page">
        <p>Please log in to see your routes.</p>
      </div>
    )
  }

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <h1>Routes</h1>
        <p class="page-subtitle">
          Courses you have run more than once, recognised from GPS tracks. A route is the same course in the
          same direction and activity type.
        </p>
      </div>

      {isLoading && <p class="loading">Loading routes...</p>}
      {!isLoading && routes.length === 0 && (
        <p class="routes-empty">No routes yet. One appears when two tracks cover the same course.</p>
      )}

      {routes.length > 0 && (
        <div class="routes-list">
          {routes.map((route) => (
            <a key={route.id} href={`/routes/${route.id}`} class="route-row">
              <span class="route-name">{route.name}</span>
              <span class="route-type">{route.activity_type}</span>
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
