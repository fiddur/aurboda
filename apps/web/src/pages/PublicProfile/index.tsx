import { useQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'

/**
 * PublicProfile - a user's public page at /u/:username, listing their public
 * shared dashboards and challenges. Unauthenticated; rendered without app chrome.
 */
import type { PostAuthor } from '../Feed/FeedPostCard'

import { avatarUrl, fetchPublicPosts, fetchPublicProfile } from '../../state/api'
import { FeedPostCard } from '../Feed/FeedPostCard'
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

  const postsQuery = useQuery({
    queryFn: () => fetchPublicPosts(username),
    queryKey: ['publicPosts', username],
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
  const posts = postsQuery.data ?? []

  // The profile owner is the author of every post shown here; the same identity
  // the owner's own feed builds (`@user@host`, avatar on this host).
  const author: PostAuthor = {
    avatarUrl: avatarUrl(username),
    displayName: username,
    handle: `@${username}@${window.location.host}`,
    profileUrl: `/u/${encodeURIComponent(username)}`,
    username,
  }

  const renderItem = (item: { name: string; slug: string }) => (
    <li key={item.slug}>
      <a href={`/u/${encodeURIComponent(username)}/${encodeURIComponent(item.slug)}`}>{item.name}</a>
    </li>
  )

  return (
    <div class="public-profile">
      {/* A <div>, not <header>: the global `header` rule paints a #673ab8 bar
          (mobile nav style) behind the content, so avoid the semantic element
          here (#883). */}
      <div class="public-profile-header">
        <img
          class="public-avatar"
          src={avatarUrl(username)}
          alt={`${username}'s avatar`}
          width={80}
          height={80}
        />
        <h1>@{username}</h1>
      </div>

      <section class="public-section">
        <h2>Posts</h2>
        {postsQuery.isLoading ? (
          <p class="public-muted">Loading…</p>
        ) : posts.length === 0 ? (
          <p class="public-muted">This user has no public posts.</p>
        ) : (
          posts.map((post) => <FeedPostCard key={post.id} post={post} author={author} />)
        )}
      </section>

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
