/**
 * PublicProfile - a user's public page at /u/:username, listing their public
 * shared dashboards. Unauthenticated; rendered without app chrome.
 */
import { useQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'

import { fetchPublicProfile } from '../../state/api'
import './style.css'

export function PublicProfile() {
  const { params } = useRoute()
  const username = params.username

  const query = useQuery({
    queryFn: () => fetchPublicProfile(username),
    queryKey: ['publicProfile', username],
    retry: false,
    staleTime: 60 * 1000,
  })

  if (query.isLoading) {
    return (
      <div class="public-profile">
        <div class="public-loading">Loading…</div>
      </div>
    )
  }

  if (query.isError || !query.data?.success) {
    return (
      <div class="public-profile">
        <h1>Profile not found</h1>
        <p class="public-muted">No public profile exists for this user.</p>
      </div>
    )
  }

  const dashboards = query.data.dashboards ?? []

  return (
    <div class="public-profile">
      <h1>@{username}</h1>
      {dashboards.length === 0 ? (
        <p class="public-muted">This user has no public dashboards.</p>
      ) : (
        <ul class="public-dashboard-list">
          {dashboards.map((d) => (
            <li key={d.slug}>
              <a href={`/u/${encodeURIComponent(username)}/${encodeURIComponent(d.slug)}`}>{d.name}</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
