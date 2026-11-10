import type { OfficialFeedResponse } from '@aurboda/api-spec'
import type { InfiniteData } from '@tanstack/react-query'

import { useInfiniteQuery } from '@tanstack/react-query'

import { officialFeedSummary } from '../../components/official-feed'
import { PublicTagLinks } from '../../components/PublicTagLinks'
import { fetchOfficialFeed, officialFeedAtomUrl } from '../../state/api'
import { FeedPostCard } from '../Feed/FeedPostCard'
import { publicAuthor } from '../PublicProfile/public-author'
import '../PublicProfile/style.css'
import './style.css'

/**
 * OfficialFeed - the instance's blog at /blog: public posts by the users the
 * admin chose that carry one of the chosen tags, newest first, with an Atom
 * feed. Unauthenticated.
 */
export function OfficialFeed() {
  const postsQuery = useInfiniteQuery<
    OfficialFeedResponse,
    Error,
    InfiniteData<OfficialFeedResponse>,
    readonly string[],
    string | undefined
  >({
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam }) => fetchOfficialFeed(pageParam),
    queryKey: ['officialFeed'],
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
        <h1>No blog here</h1>
        <p class="public-muted">This instance has no blog.</p>
      </div>
    )
  }

  const pages = postsQuery.data?.pages ?? []
  const posts = pages.flatMap((page) => page.posts)
  const users = pages[0]?.users ?? []
  const tags = pages[0]?.tags ?? []

  return (
    <div class="public-profile">
      <div class="official-feed-header">
        <h1>
          Blog <span class="official-feed-host">{window.location.host}</span>
        </h1>
        {users.length > 0 && <p class="official-feed-summary">{officialFeedSummary(users, tags)}</p>}
        <p class="official-feed-links">
          <a href={officialFeedAtomUrl()} type="application/atom+xml">
            Atom feed
          </a>
        </p>
        <PublicTagLinks class="official-feed-links" />
      </div>

      <section class="public-section">
        {posts.length === 0 ? (
          <p class="public-muted">No posts yet.</p>
        ) : (
          posts.map((post) => (
            <FeedPostCard key={post.id} post={post} author={publicAuthor(post.author_username)} visitor />
          ))
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
