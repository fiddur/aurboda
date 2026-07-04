/**
 * Shared "followers" business logic — used by both the REST `/feed/followers`
 * router and the MCP follower tools (parity). This is the *management* side of
 * the follower relationship: list who follows you and, when you require manual
 * approval, approve or reject pending follow requests.
 *
 * Approving a pending follower marks the `feed_follower` row accepted and sends
 * the deferred `Accept` (echoing the id of the Follow they sent so their server
 * matches it to the pending request). Rejecting — or removing an already-accepted
 * follower — sends a `Reject` and drops the row. Delivery is best-effort and
 * synchronous, matching the rest of the feed: a failed POST is logged, not
 * retried (the local state change still takes effect). The pure `serializeFollower`
 * and `reconstructFollow` mappers are unit-tested; the network orchestration is thin.
 */
import type { FollowerActor } from '@aurboda/api-spec'

import { Accept, Follow, Reject } from '@fedify/fedify/vocab'

import type { FeedFollowerRecord } from '../db/index.ts'
import type { FollowDeps } from './following.ts'

import { removeFeedFollowerById, setFeedFollowerAccepted } from '../db/index.ts'

/**
 * The network-requiring follower operations, injected into the REST router + MCP
 * tools (mirroring `FollowActions`) so those layers stay decoupled from the
 * ActivityPub context and testable without it. Listing followers is pure DB, so
 * it isn't part of this interface — the router/tools query it directly.
 */
export interface FollowerActions {
  approve: (user: string, id: string) => Promise<FollowerActor | null>
  reject: (user: string, id: string) => Promise<boolean>
}

/** Serialise a stored follower for the owner-facing REST/MCP surface (no inbox URIs). */
export const serializeFollower = (record: FeedFollowerRecord): FollowerActor => ({
  accepted: record.accepted,
  actor_uri: record.actor_uri,
  avatar_url: record.avatar_url,
  created_at: record.created_at.toISOString(),
  display_name: record.display_name,
  handle: record.handle,
  id: record.id,
})

/**
 * Reconstruct the `Follow` a follower sent us, so it can be wrapped in the
 * `Accept`/`Reject` we send back. Echoing the original Follow id (when we cached
 * it) lets the follower's server match the response to its pending request.
 */
export const reconstructFollow = (
  followerActorUri: string,
  ourActorUri: URL,
  followActivityUri: string | null,
): Follow =>
  new Follow({
    actor: new URL(followerActorUri),
    id: followActivityUri ? new URL(followActivityUri) : null,
    object: ourActorUri,
  })

/** Build the recipient descriptor Fedify's `sendActivity` needs from a stored follower. */
const followerRecipient = (record: FeedFollowerRecord) => ({
  endpoints: record.shared_inbox_uri ? { sharedInbox: new URL(record.shared_inbox_uri) } : null,
  id: new URL(record.actor_uri),
  inboxId: new URL(record.inbox_uri),
})

/**
 * Approve a pending follower: mark them accepted and send the deferred `Accept`.
 * Returns the updated follower, or null if there's no such follower. The Accept
 * POST is best-effort (a failure is logged; they're accepted locally regardless).
 */
export const approveFollower = async (
  deps: FollowDeps,
  user: string,
  id: string,
): Promise<FeedFollowerRecord | null> => {
  const record = await setFeedFollowerAccepted(user, id)
  if (record == null) return null

  const ctx = await deps.federation.createContext(new URL(deps.origin))
  try {
    await ctx.sendActivity(
      { identifier: user },
      followerRecipient(record),
      new Accept({
        actor: ctx.getActorUri(user),
        object: reconstructFollow(record.actor_uri, ctx.getActorUri(user), record.follow_activity_uri),
      }),
    )
  } catch (error) {
    console.error(`⚠️ Accept delivery failed for ${user} ← ${record.actor_uri}:`, error)
  }

  return record
}

/**
 * Reject a pending follower, or remove an already-accepted one: drop the row and
 * send a `Reject` to their inbox. Returns false if there was no such follower.
 * The Reject POST is best-effort (a failure is logged; they're removed locally).
 */
export const rejectFollower = async (deps: FollowDeps, user: string, id: string): Promise<boolean> => {
  const removed = await removeFeedFollowerById(user, id)
  if (removed == null) return false

  const ctx = await deps.federation.createContext(new URL(deps.origin))
  try {
    await ctx.sendActivity(
      { identifier: user },
      followerRecipient(removed),
      new Reject({
        actor: ctx.getActorUri(user),
        object: reconstructFollow(removed.actor_uri, ctx.getActorUri(user), removed.follow_activity_uri),
      }),
    )
  } catch (error) {
    console.error(`⚠️ Reject delivery failed for ${user} ← ${removed.actor_uri}:`, error)
  }

  return true
}
