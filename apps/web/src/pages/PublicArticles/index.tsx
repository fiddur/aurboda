import type { FeedPostsResponse } from '@aurboda/api-spec'
import type { InfiniteData } from '@tanstack/react-query'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'

/**
 * PublicArticles - a user's blog at /u/:username/articles: their public and
 * unlisted articles, newest first, with an Atom feed for readers without a
 * fediverse account. Unauthenticated; rendered without app chrome.
 */
import { articlesAtomUrl, avatarUrl, fetchPublicPosts } from '../../state/api'
import { FeedPostCard } from '../Feed/FeedPostCard'
import { publicAuthor } from '../PublicProfile/public-author'
import '../PublicProfile/style.css'
import './style.css'

export function PublicArticles() {
  const { params } = useRoute()
  const username = params.username
  const profileUrl = `/u/${encodeURIComponent(username)}`

  const postsQuery = useInfiniteQuery<
    FeedPostsResponse,
    Error,
    InfiniteData<FeedPostsResponse>,
    readonly string[],
    string | undefined
  >({
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam }) => fetchPublicPosts(username, pageParam, 'article'),
    queryKey: ['publicArticles', username],
    retry: false,
    staleTime: 60 * 1000,
  })

  if (postsQuery.isLoading) {
    return (
      <div class="public-profile">
        <div class="public-loading">Loading…</div>
      </div>
    )
  }

  if (postsQuery.isError) {
    return (
      <div class="public-profile">
        <h1>Blog not found</h1>
        <p class="public-muted">No public profile exists for this user.</p>
      </div>
    )
  }

  const posts = postsQuery.data?.pages.flatMap((page) => page.posts) ?? []
  const author = publicAuthor(username)

  return (
    <div class="public-profile">
      <div class="public-profile-header">
        <a class="public-blog-author" href={profileUrl}>
          <img
            class="public-avatar"
            src={avatarUrl(username)}
            alt={`${username}'s avatar`}
            width={80}
            height={80}
          />
        </a>
        <div class="public-blog-title">
          <h1>
            <a href={profileUrl}>@{username}</a> · Blog
          </h1>
          <p class="public-blog-links">
            <a href={profileUrl}>Profile</a> ·{' '}
            <a href={articlesAtomUrl(username)} type="application/atom+xml">
              Atom feed
            </a>
          </p>
        </div>
      </div>

      <section class="public-section">
        {posts.length === 0 ? (
          <p class="public-muted">No articles yet.</p>
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
    </div>
  )
}
