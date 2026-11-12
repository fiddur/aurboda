import type { PublicTagPostsResponse } from '@aurboda/api-spec'
import type { InfiniteData } from '@tanstack/react-query'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useEffect } from 'preact/hooks'

import { publicTagSummary } from '../../components/public-tag-pages'
import { fetchPublicTagPosts, publicTagAtomUrl } from '../../state/api'
import { ensureStatusLoaded, publicTagPages } from '../../state/auth'
import { RemotePostCard } from '../Feed/RemotePostCard'
import '../OfficialFeed/style.css'
import '../PublicProfile/style.css'

/**
 * PublicTag - a public tag page at /tags/:tag: public posts carrying the tag,
 * from this server and others, newest first, with an Atom feed. Unauthenticated.
 */
export function PublicTag() {
  const { params } = useRoute()
  const tag = params.tag ?? ''

  useEffect(() => {
    ensureStatusLoaded()
  }, [])

  const postsQuery = useInfiniteQuery<
    PublicTagPostsResponse,
    Error,
    InfiniteData<PublicTagPostsResponse>,
    readonly string[],
    string | undefined
  >({
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam }) => fetchPublicTagPosts(tag, pageParam),
    queryKey: ['publicTag', tag],
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
        <h1>No page for this tag</h1>
        <p class="public-muted">This server has no public page for #{tag}.</p>
      </div>
    )
  }

  const pages = postsQuery.data?.pages ?? []
  const posts = pages.flatMap((page) => page.posts)
  const pageTag = pages[0]?.tag ?? tag
  const linkedTags = [...new Set([pageTag, ...publicTagPages.value])]

  return (
    <div class="public-profile">
      <div class="official-feed-header">
        <h1>
          #{pageTag} <span class="official-feed-host">{window.location.host}</span>
        </h1>
        {pages[0] && (
          <p class="official-feed-summary">{publicTagSummary(pageTag, pages[0].retention_days)}</p>
        )}
        <p class="official-feed-links">
          <a href={publicTagAtomUrl(pageTag)} type="application/atom+xml">
            Atom feed
          </a>
        </p>
      </div>

      <section class="public-section">
        {posts.length === 0 ? (
          <p class="public-muted">No posts yet.</p>
        ) : (
          posts.map((entry) => <RemotePostCard key={entry.id} entry={entry} pages={linkedTags} />)
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
