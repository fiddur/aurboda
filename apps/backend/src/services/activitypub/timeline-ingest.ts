/**
 * Ingest a received ActivityPub `Note` (a post from an actor the user follows)
 * into the home-timeline store.
 *
 * Two concerns live here, both testable in isolation:
 *
 * 1. `sanitizeRemoteHtml` — remote fediverse HTML is **untrusted** and is rendered
 *    with `dangerouslySetInnerHTML` on the web, so it MUST be sanitised before it
 *    is stored. We keep only the small tag set Mastodon-style content uses and
 *    force safe link attributes; scripts, styles, event handlers, iframes, images,
 *    and every other attribute are dropped.
 * 2. `noteToTimelineInput` — map a Fedify `Note` + the (already-known) author to a
 *    `TimelineEntryInput`, or null if it lacks the id/published we need.
 *
 * The inbox handler that calls these (in `federation.ts`) is thin: it checks the
 * sender is a followed, accepted actor and upserts the result.
 */
import type { Note } from '@fedify/fedify/vocab'

import sanitizeHtml from 'sanitize-html'

import type { FeedFollowingRecord, TimelineEntryInput } from '../../db/index.ts'

import { temporalInstantToDate } from './temporal-interop.ts'

/**
 * Sanitise untrusted remote HTML to the small tag set Mastodon-style post content
 * uses. Links are forced to `rel="nofollow noopener noreferrer"` + `target`, and
 * only `http(s)` schemes survive — so no `javascript:` URLs, inline handlers,
 * styles, scripts, iframes, or images.
 */
export const sanitizeRemoteHtml = (html: string): string =>
  sanitizeHtml(html, {
    allowedAttributes: {
      a: ['href', 'rel', 'target', 'class', 'translate'],
      ol: ['start'],
      span: ['class', 'translate'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedTags: [
      'p',
      'br',
      'a',
      'span',
      'em',
      'strong',
      'b',
      'i',
      'del',
      's',
      'u',
      'pre',
      'code',
      'blockquote',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'h4',
    ],
    disallowedTagsMode: 'discard',
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener noreferrer', target: '_blank' }),
    },
  })

/**
 * Map a received `Note` + its (already-resolved, followed) author to a timeline
 * entry, or null if the Note lacks an id or a `published` timestamp. The author's
 * presentation (handle / name / avatar) comes from the cached `feed_following`
 * row — no extra network — since we only ingest posts from actors we follow.
 */
export const noteToTimelineInput = (note: Note, author: FeedFollowingRecord): TimelineEntryInput | null => {
  if (note.id == null || note.published == null) return null
  return {
    actor_uri: author.actor_uri,
    avatar_url: author.avatar_url,
    content: sanitizeRemoteHtml(note.content?.toString() ?? ''),
    display_name: author.display_name,
    handle: author.handle,
    object_uri: note.id.href,
    published_at: temporalInstantToDate(note.published),
    url: note.url instanceof URL ? note.url.href : note.id.href,
  }
}
