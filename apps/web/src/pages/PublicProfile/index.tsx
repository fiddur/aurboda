/**
 * PublicProfile - a user's public page at /u/:username, listing their public
 * shared dashboards and challenges. Unauthenticated; rendered without app chrome.
 */
import { useQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'

import { avatarUrl, fetchPublicProfile } from '../../state/api'
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
  const challenges = query.data.challenges ?? []

  const renderItem = (item: { name: string; slug: string }) => (
    <li key={item.slug}>
      <a href={`/u/${encodeURIComponent(username)}/${encodeURIComponent(item.slug)}`}>{item.name}</a>
    </li>
  )

  return (
    <div class="public-profile">
      <header class="public-profile-header">
        <img
          class="public-avatar"
          src={avatarUrl(username)}
          alt={`${username}'s avatar`}
          width={80}
          height={80}
        />
        <h1>@{username}</h1>
      </header>

      <section class="public-section">
        <h2>Dashboards</h2>
        {dashboards.length === 0 ? (
          <p class="public-muted">This user has no public dashboards.</p>
        ) : (
          <ul class="public-item-list">{dashboards.map(renderItem)}</ul>
        )}
      </section>

      <section class="public-section">
        <h2>Challenges</h2>
        {challenges.length === 0 ? (
          <p class="public-muted">This user has no public challenges.</p>
        ) : (
          <ul class="public-item-list">{challenges.map(renderItem)}</ul>
        )}
      </section>
    </div>
  )
}
