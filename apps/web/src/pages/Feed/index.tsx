/**
 * Feed / outbox view — the activities the user has published to their federated
 * (ActivityPub) feed, rendered as native Mastodon-style cards (matching how they
 * actually appear once federated), each with an Edit / Unshare shortcut. Editing
 * reuses the share dialog; unsharing retracts a Delete to followers.
 */
import type { FeedPost } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { ArticleEditorDialog } from '../../components/ArticleEditorDialog'
import { ShareActivityDialog } from '../../components/ShareActivityDialog'
import { avatarUrl, deleteFeedPost, fetchFeed } from '../../state/api'
import { auth } from '../../state/auth'
import { FeedPostCard, type PostAuthor } from './FeedPostCard'
import { FollowersPanel } from './FollowersPanel'
import { FollowingPanel } from './FollowingPanel'
import { HomeTimeline } from './HomeTimeline'
import './style.css'

function OwnPostCard({ post, author }: { post: FeedPost; author: PostAuthor }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const activityId = post.activity_id
  const isArticle = post.kind === 'article'

  const deleteMutation = useMutation({
    mutationFn: () => deleteFeedPost(post.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  })

  const onUnshare = () => {
    if (window.confirm('Unshare this post? It is removed from your feed and retracted from followers.')) {
      deleteMutation.mutate()
    }
  }

  return (
    <>
      <FeedPostCard
        post={post}
        author={author}
        footer={
          <>
            {(activityId || isArticle) && (
              <button type="button" class="btn-secondary" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            <button type="button" class="btn-danger" onClick={onUnshare} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Unsharing…' : 'Unshare'}
            </button>
          </>
        }
      />

      {editing && isArticle && <ArticleEditorDialog post={post} onClose={() => setEditing(false)} />}

      {editing && !isArticle && activityId && (
        <ShareActivityDialog
          activityId={activityId}
          activityTitle={post.activity_title}
          activityStart={post.activity_start_time ? new Date(post.activity_start_time) : undefined}
          activityEnd={post.activity_end_time ? new Date(post.activity_end_time) : undefined}
          post={post}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  )
}

export function Feed() {
  const { data: posts, isLoading, error } = useQuery({ queryFn: fetchFeed, queryKey: ['feed'] })
  const [composing, setComposing] = useState(false)

  const username = auth.value.user ?? ''
  // The actor handle host is the web host the user is browsing (`<user>@<host>`);
  // the actor lives at `<host>/users/<user>` and WebFinger resolves that host.
  const host = window.location.host
  const author: PostAuthor = {
    avatarUrl: avatarUrl(username),
    displayName: username,
    handle: `@${username}@${host}`,
    profileUrl: `/u/${encodeURIComponent(username)}`,
    username,
  }

  return (
    <div class="feed-page">
      <h1>Feed</h1>
      <p class="feed-intro">
        Activities you've published to your federated feed, shown the way they appear once federated. People
        can follow your <code>{author.handle}</code> from Mastodon and the wider fediverse to see these posts.
      </p>

      <FollowingPanel />

      <FollowersPanel />

      <HomeTimeline />

      <div class="feed-section-header">
        <h2 class="feed-section-title">Your posts</h2>
        <button type="button" class="btn-primary" onClick={() => setComposing(true)}>
          New article
        </button>
      </div>
      {composing && <ArticleEditorDialog onClose={() => setComposing(false)} />}
      {isLoading && <p>Loading…</p>}
      {error && <p class="feed-error">Couldn't load your feed. Please try again.</p>}
      {posts && posts.length === 0 && (
        <p class="feed-empty">
          You haven't shared anything yet. Open an activity and choose <strong>Share to feed</strong>.
        </p>
      )}
      {posts?.map((post) => (
        <OwnPostCard key={post.id} post={post} author={author} />
      ))}
    </div>
  )
}
