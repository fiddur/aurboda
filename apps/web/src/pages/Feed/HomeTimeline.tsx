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
import { useState } from 'preact/hooks'

import { fetchTimeline } from '../../state/api'
import { ActorName } from './ActorName'
import { timelineImageVisible } from './timeline-structured'
import { TimelineStructured } from './TimelineStructured'
import { useTimelineLive } from './useTimelineLive'

/** De-duplicate entries by `object_uri`, keeping the first (newest) occurrence. */
const dedupByUri = (list: TimelineEntry[]): TimelineEntry[] => {
  const seen = new Set<string>()
  const out: TimelineEntry[] = []
  for (const entry of list) {
    if (!seen.has(entry.object_uri)) {
      seen.add(entry.object_uri)
      out.push(entry)
    }
  }
  return out
}

/**
 * A fallback avatar (a neutral silhouette) for actors without an icon. Colours use
 * raw `#` — `encodeURIComponent` percent-encodes them exactly once (writing `%23`
 * here too would double-encode to `%2523` and render the fills black).
 */
const FALLBACK_AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><rect width="44" height="44" rx="22" fill="#cbd5e1"/><circle cx="22" cy="17" r="8" fill="#fff"/><path d="M8 40c0-8 6-12 14-12s14 4 14 12" fill="#fff"/></svg>',
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
          <span class="feed-post-name">
            <ActorName name={name} actorUri={entry.actor_uri} />
          </span>
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

      {/* Sanitised server-side on ingest (timeline-ingest.ts) — safe to render.
          Suppressed whenever the post has a native structured render (below),
          whose content covers the same title/message/stats (article: title +
          prose + captions; activity: title + message + date + stat grid) — else
          the post shows twice (#997). */}
      {!entry.structured && (
        <div class="feed-post-content" dangerouslySetInnerHTML={{ __html: entry.content }} />
      )}

      {/* Native structured data (Aurboda peers) → a real chart+map / inline
          article; otherwise fall back to the delivered image attachment(s), the
          way Mastodon shows them. `timelineImageVisible` keeps each image
          unless its native counterpart actually renders. */}
      {entry.structured && <TimelineStructured structured={entry.structured} />}
      {entry.images
        ?.filter((img) => timelineImageVisible(entry.structured, img.name))
        .map((img) => (
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

  // Posts that arrived live (or via the polling fallback) since the page loaded:
  // buffered in `pending` (shown as a pill) until the user reveals them, then
  // prepended via `revealed`. Both are de-duped against the query data on render.
  const [pending, setPending] = useState<TimelineEntry[]>([])
  const [revealed, setRevealed] = useState<TimelineEntry[]>([])

  // On a live ping (or poll tick), refetch the newest page and buffer anything we
  // aren't already showing. Cheap: one page, and only when the server says so.
  const checkForNew = async () => {
    try {
      const { entries: latest } = await fetchTimeline()
      const known = new Set([...revealed, ...pending, ...entries].map((entry) => entry.object_uri))
      const fresh = latest.filter((entry) => !known.has(entry.object_uri))
      if (fresh.length > 0) setPending((prev) => dedupByUri([...fresh, ...prev]))
    } catch {
      // A transient refetch failure just means the pill doesn't update this tick.
    }
  }
  useTimelineLive(() => void checkForNew())

  const reveal = () => {
    setRevealed((prev) => dedupByUri([...pending, ...prev]))
    setPending([])
    window.scrollTo({ behavior: 'smooth', top: 0 })
  }

  const displayed = dedupByUri([...revealed, ...entries])

  return (
    <section class="timeline-section">
      <h2 class="feed-section-title">Home timeline</h2>
      {pending.length > 0 && (
        <button type="button" class="timeline-new-pill" onClick={reveal}>
          {pending.length} new post{pending.length === 1 ? '' : 's'}
        </button>
      )}
      {isLoading && <p>Loading…</p>}
      {error && <p class="feed-error">Couldn't load your timeline. Please try again.</p>}
      {!isLoading && !error && displayed.length === 0 && (
        <p class="feed-empty">
          No posts yet. Follow some fediverse accounts above and their posts will appear here.
        </p>
      )}
      {displayed.map((entry) => (
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
