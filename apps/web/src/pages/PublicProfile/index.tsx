/**
 * PublicProfile - a user's public page at /u/:username, listing their public
 * shared dashboards, challenges and exercises. Unauthenticated; rendered without app chrome.
 */
import type { FeedPostsResponse } from '@aurboda/api-spec'
import type { InfiniteData } from '@tanstack/react-query'

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'

import { tagFilterFromQuery } from '../../components/hashtags'
import { avatarUrl, blogPath, fetchPublicPosts, fetchPublicProfile } from '../../state/api'
import { FeedPostCard } from '../Feed/FeedPostCard'
import { publicAuthor } from './public-author'
import './style.css'

function PublicList({
  items = [],
  title,
  username,
}: {
  items?: { name: string; slug: string }[]
  title: string
  username: string
}) {
  return (
    <section class="public-section">
      <h2>{title}</h2>
      {items.length === 0 ? (
        <p class="public-muted">This user has no public {title.toLowerCase()}.</p>
      ) : (
        <ul class="public-item-list">
          {items.map((item) => (
            <li key={item.slug}>
              <a href={`/u/${encodeURIComponent(username)}/${encodeURIComponent(item.slug)}`}>{item.name}</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function PublicProfile() {
  const { params, query: search } = useRoute()
  const username = params.username
  const tag = tagFilterFromQuery(search.tag)

  const query = useQuery({
    queryFn: () => fetchPublicProfile(username),
    queryKey: ['publicProfile', username],
    retry: false,
    staleTime: 60 * 1000,
  })

  // Keyset-paginated with a "Load more", exactly like the owner's own feed
  // (#1055): every page carries full structured payloads, so the profile shows a
  // bounded page at a time instead of a hard ceiling of 20.
  const postsQuery = useInfiniteQuery<
    FeedPostsResponse,
    Error,
    InfiniteData<FeedPostsResponse>,
    readonly string[],
    string | undefined
  >({
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam }) => fetchPublicPosts(username, pageParam, undefined, tag ?? undefined),
    queryKey: ['publicPosts', username, tag ?? ''],
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

  const posts = postsQuery.data?.pages.flatMap((page) => page.posts) ?? []

  const author = publicAuthor(username)

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
        {query.data.has_articles && (
          <a class="public-blog-link" href={blogPath(username)}>
            Blog
          </a>
        )}
      </div>

      <section class="public-section">
        <h2>Posts</h2>
        {tag && (
          <p class="public-muted">
            Posts tagged #{tag} · <a href={`/u/${encodeURIComponent(username)}`}>clear</a>
          </p>
        )}
        {postsQuery.isLoading ? (
          <p class="public-muted">Loading…</p>
        ) : posts.length === 0 ? (
          <p class="public-muted">
            {tag ? `This user has no public posts tagged #${tag}.` : 'This user has no public posts.'}
          </p>
        ) : (
          posts.map((post) => <FeedPostCard key={post.id} post={post} author={author} visitor />)
        )}
        {postsQuery.hasNextPage && (
          <button
            type="button"
            class="btn-secondary timeline-more"
            onClick={() => postsQuery.fetchNextPage()}
            disabled={postsQuery.isFetchingNextPage}
          >
            {postsQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </section>

      <PublicList username={username} title="Dashboards" items={query.data.dashboards} />
      <PublicList username={username} title="Challenges" items={query.data.challenges} />
      <PublicList username={username} title="Exercises" items={query.data.exercises} />
    </div>
  )
}
