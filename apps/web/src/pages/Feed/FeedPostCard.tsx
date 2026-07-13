/**
 * A single feed post rendered as it actually federates — a Mastodon-style card
 * (author, handle, timestamp, visibility, the AS2 `content` HTML, and any
 * chart/route image attachments) rather than a management chip list (#884 §1).
 *
 * Reusable for the future home timeline: the author identity is passed in, so
 * the same card renders both the viewer's own posts and (later) remote actors'.
 * `footer` carries per-post controls (Edit / Unshare) for the viewer's own posts.
 */
import type { FeedPost, FeedVisibility } from '@aurboda/api-spec'
import type { ComponentChildren } from 'preact'

import { formatDistanceToNow } from 'date-fns'

import { API_URL } from '../../config'
import './FeedPostCard.css'

export interface PostAuthor {
  displayName: string
  /** `@user@host`. */
  handle: string
  /** Local username, used to build the post's image URLs. */
  username: string
  avatarUrl: string
  profileUrl?: string
}

const VISIBILITY: Record<FeedVisibility, { icon: string; label: string }> = {
  followers: { icon: '🔒', label: 'Followers only' },
  public: { icon: '🌐', label: 'Public' },
  unlisted: { icon: '🔓', label: 'Unlisted' },
}

/**
 * A public/unlisted post's rendered image URL, or `null`. `followers`-only images
 * are token-gated and the browser has no token (#893), so they're omitted here.
 */
const imageUrl = (username: string, post: FeedPost, kind: 'chart' | 'route'): string | null =>
  post.visibility === 'followers'
    ? null
    : `${API_URL}/public/${encodeURIComponent(username)}/feed/${post.id}/${kind}.png`

export const FeedPostCard = ({
  post,
  author,
  footer,
}: {
  post: FeedPost
  author: PostAuthor
  footer?: ComponentChildren
}) => {
  const vis = VISIBILITY[post.visibility]
  const when = formatDistanceToNow(new Date(post.created_at), { addSuffix: true })
  const chart = post.include_chart ? imageUrl(author.username, post, 'chart') : null
  const route = post.include_map ? imageUrl(author.username, post, 'route') : null

  return (
    <article class="feed-post">
      <header class="feed-post-head">
        <img class="feed-post-avatar" src={author.avatarUrl} alt="" width={44} height={44} />
        <div class="feed-post-ident">
          <span class="feed-post-name">{author.displayName}</span>
          <span class="feed-post-handle">
            {author.handle} · <time title={new Date(post.created_at).toLocaleString()}>{when}</time> ·{' '}
            <span title={vis.label} aria-label={vis.label}>
              {vis.icon}
            </span>
          </span>
        </div>
      </header>

      {/* Server-generated, HTML-escaped `content` (see serializeFeedPost) — safe
          to render directly. Remote timeline content will need sanitising. */}
      {post.content ? (
        <div class="feed-post-content" dangerouslySetInnerHTML={{ __html: post.content }} />
      ) : (
        <div class="feed-post-content">{post.activity_title ?? 'Shared activity'}</div>
      )}

      {(chart || route) && (
        <div class="feed-post-media">
          {chart && <img class="feed-post-image" src={chart} alt="Heart rate chart" loading="lazy" />}
          {route && <img class="feed-post-image" src={route} alt="Route map" loading="lazy" />}
        </div>
      )}

      {footer && <footer class="feed-post-footer">{footer}</footer>}
    </article>
  )
}
