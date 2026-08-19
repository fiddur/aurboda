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
import { formatEntryWindow } from './activity-stats'
import { ActivityStatGrid } from './ActivityStatGrid'
import { ArticleContent } from './ArticleContent'
import { structuredChartSeries } from './timeline-structured'
import { TimelineStructured } from './TimelineStructured'
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

/**
 * The post's static image URLs. The chart.png is replaced only when the native
 * interactive chart ACTUALLY renders — `structured` is attached to every
 * activity post, so keying on its mere presence would drop the chart from an
 * `include_chart` post whose series is empty/undrawable. The route map has no
 * native render, so its image always stays.
 */
const mediaUrls = (post: FeedPost, username: string): { chart: string | null; route: string | null } => {
  const nativeChart =
    post.structured?.kind === 'activity' && structuredChartSeries(post.structured).length > 0
  return {
    chart: post.include_chart && !nativeChart ? imageUrl(username, post, 'chart') : null,
    route: post.include_map ? imageUrl(username, post, 'route') : null,
  }
}

/**
 * Native body for an activity post with resolved typed metrics (#997): title,
 * personal message, the activity's own date (#998), and a stat grid — instead
 * of the flattened `content` HTML Mastodon sees.
 */
const ActivityPostBody = ({ post }: { post: FeedPost }) => (
  <div class="feed-post-content">
    <p class="feed-post-title">
      <strong>{post.activity_title ?? 'Shared activity'}</strong>
    </p>
    {post.message && <p class="feed-post-message">{post.message}</p>}
    {post.activity_start_time && (
      <p class="feed-post-window">{formatEntryWindow(post.activity_start_time, post.activity_end_time)}</p>
    )}
    {post.metrics && <ActivityStatGrid metrics={post.metrics} />}
  </div>
)

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
  const { chart, route } = mediaUrls(post, author.username)

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

      {/* An article renders its own title + prose/chart blocks (prose sanitised
          via the shared sanitiser). An activity post with the full structured
          payload renders the SAME `TimelineStructured` component a subscribing
          Aurboda peer's home timeline uses (#1008) — interactive hover charts
          included — so the owner sees exactly what a follower sees. Without it
          (public profile), the stat-grid `ActivityPostBody`; older payloads
          fall back to the server-built, HTML-escaped `content`. */}
      {post.kind === 'article' && post.article ? (
        <ArticleContent article={post.article} />
      ) : post.structured ? (
        <TimelineStructured structured={post.structured} />
      ) : post.metrics ? (
        <ActivityPostBody post={post} />
      ) : post.content ? (
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
