/**
 * Shared "following" business logic — used by both the REST `/feed/following`
 * router and the MCP follow tools (parity), plus the mapping the ActivityPub
 * layer needs when a followed actor is resolved.
 *
 * Following an actor is the inbound direction of the feed: we resolve the target
 * actor (WebFinger + actor fetch, via Fedify), persist a *pending* follow with
 * the followee's cached inbox + presentation, then send a signed `Follow`. The
 * relationship flips to `accepted` when the followee's server answers with an
 * `Accept` (handled in `federation.ts`). Unfollowing sends an `Undo{Follow}` to
 * the cached inbox and drops the row.
 *
 * Delivery is best-effort and synchronous, matching the rest of the feed's
 * delivery model (no message queue): a Follow/Undo whose POST fails is logged,
 * not retried — the pending row lets the user re-follow to re-send. The pure
 * `actorToFollowingInput` / `serializeFollowing` mappers are unit-tested; the
 * network orchestration is thin.
 */
import type { FollowingActor } from '@aurboda/api-spec'
import type { Federation } from '@fedify/fedify'
import type { Actor } from '@fedify/fedify/vocab'

import { Follow, isActor, Undo } from '@fedify/fedify/vocab'

import type { FeedFollowingInput, FeedFollowingRecord } from '../db/index.ts'

import {
  deleteTimelineEntriesByActor,
  getFeedFollowing,
  removeFeedFollowing,
  upsertFeedFollowing,
} from '../db/index.ts'

export interface FollowDeps {
  federation: Federation<void>
  /** Canonical web origin, e.g. `https://aurboda.net`. */
  origin: string
}

/**
 * The network-requiring follow operations, injected into the REST router + MCP
 * tools (mirroring `FeedDeliver`) so those layers stay decoupled from the
 * ActivityPub context and testable without it. Listing follows is pure DB, so it
 * isn't part of this interface — the router/tools query it directly.
 */
export interface FollowActions {
  follow: (user: string, handle: string) => Promise<FollowResult>
  unfollow: (user: string, id: string) => Promise<boolean>
}

/**
 * Outcome of a follow attempt. A resolution failure (unresolvable handle,
 * non-actor object) is a `4xx` the caller surfaces — not a thrown error — so the
 * REST/MCP layers can report it cleanly.
 */
export type FollowResult =
  | { ok: true; record: FeedFollowingRecord }
  | { ok: false; status: number; error: string }

/** Map a `LanguageString | string | null` (Fedify vocab value) to a plain string or null. */
const toPlainString = (value: unknown): string | null => {
  if (value == null) return null
  const str = String(value).trim()
  return str.length > 0 ? str : null
}

/** How long to wait for an actor's icon before giving up (avatar is non-essential). */
const ICON_FETCH_TIMEOUT_MS = 3000

/** Reject `promise` if it doesn't settle within `ms` (clearing the timer either way). Exported for testing. */
export const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Extract the persisted fields of a followee from a resolved Fedify actor, or
 * null if it lacks the id/inbox we require to follow + later unfollow it.
 *
 * The handle is derived from `preferredUsername` + the actor id's host rather
 * than `getActorHandle` (which may WebFinger the host): this is deterministic and
 * offline — good enough for a display handle, and it can't hang. The avatar comes
 * from the actor's embedded `icon` — Mastodon inlines it (no fetch), but a server
 * that only links it would make `getIcon()` dereference a URL, so it's bounded by
 * a timeout: a slow icon host must not hang the synchronous follow. Unit-tested
 * with a constructed `Person`.
 */
export const actorToFollowingInput = async (actor: Actor): Promise<FeedFollowingInput | null> => {
  if (actor.id == null || actor.inboxId == null) return null
  const username = toPlainString(actor.preferredUsername)
  const handle = username == null ? null : `@${username}@${actor.id.host}`
  let avatarUrl: string | null = null
  try {
    const icon = await withTimeout(actor.getIcon(), ICON_FETCH_TIMEOUT_MS)
    avatarUrl = icon?.url instanceof URL ? icon.url.href : null
  } catch {
    avatarUrl = null
  }
  return {
    actor_uri: actor.id.href,
    avatar_url: avatarUrl,
    display_name: toPlainString(actor.name),
    handle,
    inbox_uri: actor.inboxId.href,
    shared_inbox_uri: actor.endpoints?.sharedInbox?.href ?? null,
  }
}

/** Serialise a stored followee for the owner-facing REST/MCP surface (no inbox URIs). */
export const serializeFollowing = (record: FeedFollowingRecord): FollowingActor => ({
  accepted: record.accepted,
  actor_uri: record.actor_uri,
  avatar_url: record.avatar_url,
  created_at: record.created_at.toISOString(),
  display_name: record.display_name,
  handle: record.handle,
  id: record.id,
})

/** The AS2 id we mint for our outbound Follow of a followee (stable per row). */
const followActivityId = (origin: string, user: string, followingId: string): URL =>
  new URL(`${origin.replace(/\/+$/, '')}/users/${encodeURIComponent(user)}/follows/${followingId}`)

/**
 * Resolve, persist (pending), and send a `Follow` to the target actor. Persists
 * BEFORE sending so an `Accept` that races back always finds the row to mark
 * accepted. The Follow POST is best-effort (a failure is logged, not fatal — the
 * pending row lets the user retry).
 */
export const followActor = async (deps: FollowDeps, user: string, handle: string): Promise<FollowResult> => {
  const ctx = await deps.federation.createContext(new URL(deps.origin))

  let actor: Actor | null
  try {
    const object = await ctx.lookupObject(handle)
    actor = isActor(object) ? object : null
  } catch {
    actor = null
  }
  if (actor == null) {
    return { error: `Could not resolve an actor for “${handle}”.`, ok: false, status: 404 }
  }

  // Following yourself would deliver a Follow to your own inbox and clutter the
  // timeline with your own posts — reject it before persisting a pending row.
  if (actor.id != null && actor.id.href === ctx.getActorUri(user).href) {
    return { error: 'You can’t follow yourself.', ok: false, status: 422 }
  }

  const input = await actorToFollowingInput(actor)
  if (input == null) {
    return { error: 'Resolved object is not a followable actor (no inbox).', ok: false, status: 422 }
  }

  const record = await upsertFeedFollowing(user, input)

  // Best-effort delivery: a failed POST leaves the pending row for a retry.
  try {
    await ctx.sendActivity(
      { identifier: user },
      actor,
      new Follow({
        actor: ctx.getActorUri(user),
        id: followActivityId(deps.origin, user, record.id),
        object: actor.id,
      }),
    )
  } catch (error) {
    console.error(`⚠️ Follow delivery failed for ${user} → ${record.actor_uri}:`, error)
  }

  return { ok: true, record }
}

/**
 * Send an `Undo{Follow}` to the cached inbox and drop the followee. Local
 * unfollow succeeds even if the outbound POST fails (best-effort), so the user is
 * never stuck following someone they've unfollowed locally.
 */
export const unfollowActor = async (deps: FollowDeps, user: string, id: string): Promise<boolean> => {
  const existing = await getFeedFollowing(user, id)
  if (existing == null) return false

  const ctx = await deps.federation.createContext(new URL(deps.origin))
  const recipient = {
    endpoints: existing.shared_inbox_uri ? { sharedInbox: new URL(existing.shared_inbox_uri) } : null,
    id: new URL(existing.actor_uri),
    inboxId: new URL(existing.inbox_uri),
  }
  try {
    await ctx.sendActivity(
      { identifier: user },
      recipient,
      new Undo({
        actor: ctx.getActorUri(user),
        id: new URL(`${followActivityId(deps.origin, user, existing.id).href}#undo`),
        object: new Follow({
          actor: ctx.getActorUri(user),
          id: followActivityId(deps.origin, user, existing.id),
          object: new URL(existing.actor_uri),
        }),
      }),
    )
  } catch (error) {
    console.error(`⚠️ Undo{Follow} delivery failed for ${user} → ${existing.actor_uri}:`, error)
  }

  await removeFeedFollowing(user, id)
  // Their posts leave the home timeline too (no point keeping posts from someone
  // you no longer follow).
  await deleteTimelineEntriesByActor(user, existing.actor_uri)
  return true
}
