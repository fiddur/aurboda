/**
 * Home timeline — posts received from the fediverse actors the user follows
 * (#884 §3), newest-first, keyset-paginated via the opaque `next_cursor`.
 *
 * Each entry renders as the same Mastodon-style card as the user's own posts,
 * but from a remote author. The `content` HTML was already sanitised server-side
 * on ingest (see `timeline-ingest.ts`), so it's safe to render directly here.
 */
import type { TimelineEntry, TimelineResponse } from '@aurboda/api-spec'
import type { InfiniteData } from '@tanstack/react-query'

import { useInfiniteQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'

import { fetchTimeline } from '../../state/api'

/** A fallback avatar (a neutral silhouette) for actors without an icon. */
const FALLBACK_AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><rect width="44" height="44" rx="22" fill="%23cbd5e1"/><circle cx="22" cy="17" r="8" fill="%23fff"/><path d="M8 40c0-8 6-12 14-12s14 4 14 12" fill="%23fff"/></svg>',
  )

function TimelineCard({ entry }: { entry: TimelineEntry }) {
  const when = formatDistanceToNow(new Date(entry.published_at), { addSuffix: true })
  const name = entry.display_name ?? entry.handle ?? entry.actor_uri
  return (
    <article class="feed-post">
      <header class="feed-post-head">
        <img
          class="feed-post-avatar"
          src={entry.avatar_url ?? FALLBACK_AVATAR}
          alt=""
          width={44}
          height={44}
          loading="lazy"
        />
        <div class="feed-post-ident">
          <span class="feed-post-name">{name}</span>
          <span class="feed-post-handle">
            {entry.handle && <>{entry.handle} · </>}
            {entry.url ? (
              <a href={entry.url} target="_blank" rel="noopener noreferrer nofollow">
                <time title={new Date(entry.published_at).toLocaleString()}>{when}</time>
              </a>
            ) : (
              <time title={new Date(entry.published_at).toLocaleString()}>{when}</time>
            )}
          </span>
        </div>
      </header>

      {/* Sanitised server-side on ingest (timeline-ingest.ts) — safe to render. */}
      <div class="feed-post-content" dangerouslySetInnerHTML={{ __html: entry.content }} />
    </article>
  )
}

export function HomeTimeline() {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<
    TimelineResponse,
    Error,
    InfiniteData<TimelineResponse>,
    readonly string[],
    string | undefined
  >({
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam }) => fetchTimeline(pageParam),
    queryKey: ['feed', 'timeline'],
  })

  const entries = data?.pages.flatMap((page) => page.entries) ?? []

  return (
    <section class="timeline-section">
      <h2 class="feed-section-title">Home timeline</h2>
      {isLoading && <p>Loading…</p>}
      {error && <p class="feed-error">Couldn't load your timeline. Please try again.</p>}
      {!isLoading && !error && entries.length === 0 && (
        <p class="feed-empty">
          No posts yet. Follow some fediverse accounts above and their posts will appear here.
        </p>
      )}
      {entries.map((entry) => (
        <TimelineCard key={entry.object_uri} entry={entry} />
      ))}
      {hasNextPage && (
        <button
          type="button"
          class="btn-secondary timeline-more"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  )
}
