/**
 * Feed / outbox view — the activities the user has published to their federated
 * (ActivityPub) feed. Lists each shared post with its audience and the metrics
 * it exposes, and lets the user edit the selection (reusing the share dialog in
 * edit mode) or unshare (which retracts a Delete to followers).
 */
import type { FeedPost, FeedVisibility } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useState } from 'preact/hooks'

import { seriesLabel, summaryLabel } from '../../components/feed-metrics'
import { ShareActivityDialog } from '../../components/ShareActivityDialog'
import { deleteFeedPost, fetchActivityById, fetchFeed } from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import './style.css'

const VISIBILITY_LABEL: Record<FeedVisibility, string> = {
  followers: 'Followers only',
  public: 'Public',
  unlisted: 'Unlisted',
}

const formatWhen = (iso: string): string => format(new Date(iso), 'PP')

// eslint-disable-next-line complexity -- render-heavy card: title resolution, edit/unshare actions, chips
function FeedPostCard({ post }: { post: FeedPost }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const activityId = post.activity_id

  const activityQuery = useQuery({
    enabled: activityId != null,
    queryFn: () => fetchActivityById(activityId ?? ''),
    queryKey: ['activity', activityId],
    staleTime: 5 * 60 * 1000,
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteFeedPost(post.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  })

  const activity = activityQuery.data?.activity
  const title = activity?.title || (activity ? toDisplayName(activity.activity_type) : 'Shared activity')

  const onUnshare = () => {
    if (window.confirm('Unshare this post? It is removed from your feed and retracted from followers.')) {
      deleteMutation.mutate()
    }
  }

  return (
    <div class="feed-card">
      <div class="feed-card-head">
        {activityId ? (
          <a class="feed-card-title" href={`/detail/activity/${activityId}`}>
            {title}
          </a>
        ) : (
          <span class="feed-card-title">{title}</span>
        )}
        <span class={`feed-badge feed-badge-${post.visibility}`}>{VISIBILITY_LABEL[post.visibility]}</span>
      </div>

      <div class="feed-card-meta">
        Shared {formatWhen(post.created_at)}
        {post.updated_at !== post.created_at ? ` · edited ${formatWhen(post.updated_at)}` : ''}
      </div>

      {post.included_metrics.length > 0 && (
        <div class="feed-chips">
          {post.included_metrics.map((k) => (
            <span key={k} class="feed-chip">
              {summaryLabel(k)}
            </span>
          ))}
        </div>
      )}

      {post.series_metrics.length > 0 && (
        <div class="feed-chips">
          <span class="feed-chips-label">Series</span>
          {post.series_metrics.map((k) => (
            <span key={k} class="feed-chip feed-chip-series">
              {seriesLabel(k)}
            </span>
          ))}
        </div>
      )}

      <div class="feed-card-actions">
        {activityId && (
          <button type="button" class="btn-secondary" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        <button type="button" class="btn-danger" onClick={onUnshare} disabled={deleteMutation.isPending}>
          {deleteMutation.isPending ? 'Unsharing…' : 'Unshare'}
        </button>
      </div>

      {editing && activityId && (
        <ShareActivityDialog
          activityId={activityId}
          activityTitle={activity?.title}
          activityStart={activity?.start_time}
          activityEnd={activity?.end_time}
          post={post}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}

export function Feed() {
  const { data: posts, isLoading, error } = useQuery({ queryFn: fetchFeed, queryKey: ['feed'] })

  return (
    <div class="feed-page">
      <h1>Feed</h1>
      <p class="feed-intro">
        Activities you've published to your federated feed. People can follow your{' '}
        <code>@handle@aurboda.net</code> from Mastodon and the wider fediverse to see these posts.
      </p>

      {isLoading && <p>Loading…</p>}
      {error && <p class="feed-error">Couldn't load your feed. Please try again.</p>}
      {posts && posts.length === 0 && (
        <p class="feed-empty">
          You haven't shared anything yet. Open an activity and choose <strong>Share to feed</strong>.
        </p>
      )}
      {posts?.map((post) => (
        <FeedPostCard key={post.id} post={post} />
      ))}
    </div>
  )
}
