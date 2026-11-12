import type { PublicTagPost } from '@aurboda/api-spec'

import { tagLinks } from '../../components/public-tag-pages'
import './FeedPostCard.css'
import { TimelineEntryHead } from './TimelineEntryHead'

/**
 * A public post from another server (or this one) as a public tag page or the
 * official feed shows it: the author, the received content and images, and its
 * tags, each linking to its public tag page when it has one.
 */
export function RemotePostCard({ entry, pages }: { entry: PublicTagPost; pages: readonly string[] }) {
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
