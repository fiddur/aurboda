import type { PublicTagPostsResponse, TimelineEntry } from '@aurboda/api-spec'
import type { InfiniteData } from '@tanstack/react-query'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useEffect } from 'preact/hooks'

import { publicTagSummary, tagLinks } from '../../components/public-tag-pages'
import { fetchPublicTagPosts, publicTagAtomUrl } from '../../state/api'
import { ensureStatusLoaded, publicTagPages } from '../../state/auth'
import '../Feed/FeedPostCard.css'
import { TimelineEntryHead } from '../Feed/TimelineEntryHead'
import '../OfficialFeed/style.css'
import '../PublicProfile/style.css'

function PublicTagPost({ entry, pages }: { entry: TimelineEntry; pages: readonly string[] }) {
  return (
    <article class="feed-post">
      <TimelineEntryHead entry={entry} />
      {/* Sanitised server-side on ingest, as on the home timeline. */}
      <div class="feed-post-content" dangerouslySetInnerHTML={{ __html: entry.content }} />
      {entry.images?.map((img) => (
        <img
          key={img.url}
          class="feed-post-image"
          src={img.url}
          alt={img.name ?? ''}
          width={img.width}
          height={img.height}
          loading="lazy"
        />
      ))}
      {entry.tags.length > 0 && (
        <p class="feed-post-tags">
          {tagLinks(entry.tags, pages).map(({ href, tag }) =>
            href ? (
              <a key={tag} href={href}>
                #{tag}
              </a>
            ) : (
              <span key={tag}>#{tag}</span>
            ),
          )}
        </p>
      )}
    </article>
  )
}

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
          posts.map((entry) => <PublicTagPost key={entry.id} entry={entry} pages={linkedTags} />)
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
