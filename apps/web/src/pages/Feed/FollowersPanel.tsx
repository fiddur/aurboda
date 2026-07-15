/**
 * Followers management (#884): see who follows you and — when you've enabled
 * manual approval in Settings — approve or reject pending follow requests.
 *
 * Pending requests surface at the top with Approve / Reject; approving sends the
 * deferred Accept so the remote server marks the follow established. Accepted
 * followers are listed below with a Remove action (sends a Reject). With
 * auto-accept (the default) there are simply never any pending requests.
 */
import type { FollowerActor } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { approveFollower, fetchFollowers, fetchFollowing, followActor, rejectFollower } from '../../state/api'
import { ActorName } from './ActorName'

const Avatar = ({ actor }: { actor: FollowerActor }) =>
  actor.avatar_url ? (
    <img class="following-avatar" src={actor.avatar_url} alt="" width={36} height={36} />
  ) : (
    <span class="following-avatar following-avatar--blank" aria-hidden="true" />
  )

const Ident = ({ actor }: { actor: FollowerActor }) => {
  const name = actor.display_name ?? actor.handle ?? actor.actor_uri
  return (
    <span class="following-ident">
      <span class="following-name">
        <ActorName name={name} actorUri={actor.actor_uri} />
      </span>
      {actor.handle && <span class="following-handle">{actor.handle}</span>}
    </span>
  )
}

const PendingRow = ({ actor }: { actor: FollowerActor }) => {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['followers'] })
  const approve = useMutation({ mutationFn: () => approveFollower(actor.id), onSuccess: invalidate })
  const reject = useMutation({ mutationFn: () => rejectFollower(actor.id), onSuccess: invalidate })
  const busy = approve.isPending || reject.isPending

  return (
    <li class="following-row">
      <Avatar actor={actor} />
      <Ident actor={actor} />
      <span class="followers-actions">
        <button type="button" class="btn-primary" onClick={() => approve.mutate()} disabled={busy}>
          {approve.isPending ? 'Approving…' : 'Approve'}
        </button>
        <button type="button" class="btn-secondary" onClick={() => reject.mutate()} disabled={busy}>
          {reject.isPending ? 'Rejecting…' : 'Reject'}
        </button>
      </span>
    </li>
  )
}

const AcceptedRow = ({ actor, isFollowing }: { actor: FollowerActor; isFollowing: boolean }) => {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => rejectFollower(actor.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['followers'] }),
  })
  // Follow back with the follower's handle (or actor URI — the endpoint accepts
  // either). Once it lands, the ['following'] list refetches and `isFollowing`
  // flips true, hiding this button.
  const followBack = useMutation({
    mutationFn: () => followActor(actor.handle ?? actor.actor_uri),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['following'] }),
  })

  return (
    <li class="following-row">
      <Avatar actor={actor} />
      <Ident actor={actor} />
      <span class="followers-actions">
        {!isFollowing && (
          <button
            type="button"
            class="btn-primary"
            onClick={() => followBack.mutate()}
            disabled={followBack.isPending}
            title="Follow this account back"
          >
            {followBack.isPending ? 'Following…' : 'Follow back'}
          </button>
        )}
        <button
          type="button"
          class="btn-secondary following-unfollow"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
        >
          {remove.isPending ? 'Removing…' : 'Remove'}
        </button>
      </span>
    </li>
  )
}

export function FollowersPanel() {
  const { data: followers, isLoading } = useQuery({
    queryFn: () => fetchFollowers('all'),
    queryKey: ['followers'],
  })
  // Who you already follow — drives whether an accepted follower shows "Follow
  // back". Shares the ['following'] key with FollowingPanel, so it's one fetch.
  const { data: following } = useQuery({ queryFn: fetchFollowing, queryKey: ['following'] })
  const followingUris = new Set((following ?? []).map((f) => f.actor_uri))

  const pending = followers?.filter((f) => !f.accepted) ?? []
  const accepted = followers?.filter((f) => f.accepted) ?? []

  return (
    <section class="following-panel">
      <h2 class="following-title">Followers</h2>

      {isLoading && <p>Loading…</p>}

      {pending.length > 0 && (
        <>
          <h3 class="followers-subtitle">
            Follow requests <span class="followers-count">{pending.length}</span>
          </h3>
          <ul class="following-list">
            {pending.map((actor) => (
              <PendingRow key={actor.id} actor={actor} />
            ))}
          </ul>
        </>
      )}

      {!isLoading && accepted.length === 0 && pending.length === 0 && (
        <p class="following-empty">No one is following you yet.</p>
      )}

      {accepted.length > 0 && (
        <ul class="following-list">
          {accepted.map((actor) => (
            <AcceptedRow key={actor.id} actor={actor} isFollowing={followingUris.has(actor.actor_uri)} />
          ))}
        </ul>
      )}
    </section>
  )
}
