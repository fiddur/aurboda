/**
 * Following management (#884 §2, the inbound direction of the feed): follow a
 * fediverse actor by handle and see who you follow. A follow is `pending` until
 * the remote server accepts it (shown as a badge). Their posts arriving in a home
 * timeline is a later slice — this panel is purely the relationship.
 */
import type { FollowingActor } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { fetchFollowing, followActor, unfollowActor, updateFollowingNotify } from '../../state/api'
import { ActorName } from './ActorName'

const FollowingRow = ({ actor }: { actor: FollowingActor }) => {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['following'] })
  const unfollow = useMutation({
    mutationFn: () => unfollowActor(actor.id),
    onSuccess: invalidate,
  })
  // Per-actor notification toggle (used by the app to decide which followed
  // accounts' new posts push a notification).
  const notify = useMutation({
    mutationFn: () => updateFollowingNotify(actor.id, !actor.notify_on_post),
    onSuccess: invalidate,
  })

  const name = actor.display_name ?? actor.handle ?? actor.actor_uri
  return (
    <li class="following-row">
      {actor.avatar_url ? (
        <img class="following-avatar" src={actor.avatar_url} alt="" width={36} height={36} />
      ) : (
        <span class="following-avatar following-avatar--blank" aria-hidden="true" />
      )}
      <span class="following-ident">
        <span class="following-name">
          <ActorName name={name} actorUri={actor.actor_uri} />
        </span>
        {actor.handle && <span class="following-handle">{actor.handle}</span>}
      </span>
      {!actor.accepted && (
        <span class="following-pending" title="Awaiting the remote server's acceptance">
          Pending
        </span>
      )}
      <button
        type="button"
        class="following-notify"
        aria-pressed={actor.notify_on_post}
        onClick={() => notify.mutate()}
        disabled={notify.isPending}
        title={actor.notify_on_post ? 'Notifications on — tap to mute' : 'Muted — tap to notify on new posts'}
      >
        {actor.notify_on_post ? '🔔' : '🔕'}
      </button>
      <button
        type="button"
        class="btn-secondary following-unfollow"
        onClick={() => unfollow.mutate()}
        disabled={unfollow.isPending}
      >
        {unfollow.isPending ? 'Unfollowing…' : 'Unfollow'}
      </button>
    </li>
  )
}

export function FollowingPanel() {
  const queryClient = useQueryClient()
  const { data: following, isLoading } = useQuery({ queryFn: fetchFollowing, queryKey: ['following'] })
  const [handle, setHandle] = useState('')

  const follow = useMutation({
    mutationFn: (h: string) => followActor(h),
    onSuccess: () => {
      setHandle('')
      queryClient.invalidateQueries({ queryKey: ['following'] })
    },
  })

  const onSubmit = (event: Event) => {
    event.preventDefault()
    const trimmed = handle.trim()
    if (trimmed) follow.mutate(trimmed)
  }

  return (
    <section class="following-panel">
      <h2 class="following-title">Following</h2>
      <form class="following-form" onSubmit={onSubmit}>
        <input
          class="following-input"
          type="text"
          value={handle}
          onInput={(e) => setHandle(e.currentTarget.value)}
          placeholder="@user@mastodon.social"
          aria-label="Fediverse handle to follow"
          disabled={follow.isPending}
        />
        <button type="submit" class="btn-primary" disabled={follow.isPending || !handle.trim()}>
          {follow.isPending ? 'Following…' : 'Follow'}
        </button>
      </form>
      {follow.isError && (
        <p class="following-error">
          {follow.error instanceof Error && follow.error.message
            ? follow.error.message
            : "Couldn't follow that handle. Check it and try again."}
        </p>
      )}

      {isLoading && <p>Loading…</p>}
      {following && following.length === 0 && <p class="following-empty">You aren't following anyone yet.</p>}
      {following && following.length > 0 && (
        <ul class="following-list">
          {following.map((actor) => (
            <FollowingRow key={actor.id} actor={actor} />
          ))}
        </ul>
      )}
    </section>
  )
}
