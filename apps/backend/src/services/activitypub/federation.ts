import type { FeedStructured } from '@aurboda/api-spec'
import type { Actor } from '@fedify/fedify/vocab'

import { createFederation, type Federation, type InboxContext, MemoryKvStore } from '@fedify/fedify'
import {
  Accept,
  Article,
  Create,
  Delete,
  Follow,
  Image,
  Note,
  Person,
  Reject,
  Undo,
  Update,
} from '@fedify/fedify/vocab'

/**
 * The Fedify `Federation` object for the activity feed.
 *
 * Single actor per user: the actor identifier IS the username, and the actor
 * lives at `<host>/users/<username>` — a dedicated prefix that never collides
 * with the SPA's human-facing `/u/<username>` profile/dashboard pages. It wires:
 *
 * - actor document (`Person`) with the user's published RSA public key,
 * - WebFinger (`acct:<user>@<host>` → the actor), via `mapHandle`,
 * - key-pairs dispatcher backed by the per-user `feed_actor` keypair,
 * - inbound inbox: `Follow` → persist follower + (unless the user requires
 *   manual approval) `Accept`; `Undo{Follow}` → drop the follower; `Accept`/
 *   `Reject` → resolve a Follow WE sent (mark the `feed_following` row accepted,
 *   or drop it); `Create`/`Update` of a `Note` from an *accepted followee* →
 *   ingest into the home timeline (sanitised); `Delete` → drop the received
 *   post. Fedify verifies the HTTP Signature first.
 * - followers + following collections (the latter lists this user's *accepted*
 *   follows), both backed by Postgres.
 *
 * Delivery is synchronous (no message queue — see `createFeedFederation`); a
 * persistent Postgres queue for retried, durable delivery is a later slice.
 */
import { isValidUsername } from '../../api/auth-routes.ts'
import {
  countAcceptedFeedFollowing,
  countFeedFollowers,
  countPublicFeedPosts,
  deleteTimelineEntryByUri,
  type FeedFollowingRecord,
  getFeedFollowerByActor,
  getFeedFollowingByActor,
  getFeedPostById,
  getOrCreateActorKeyPair,
  getUserSettings,
  isMissingDatabase,
  listAcceptedFeedFollowing,
  listFeedFollowers,
  listPublicFeedPostsPage,
  markFeedFollowingAccepted,
  removeFeedFollower,
  removeFeedFollowingByActor,
  upsertFeedFollower,
  upsertTimelineEntry,
} from '../../db/index.ts'
import { resolveFeedActivity } from '../feed.ts'
import { buildProfileUrl } from '../share-urls.ts'
import { extractActorPresentation } from './actor-presentation.ts'
import {
  buildFeedArticle,
  buildFeedArticleCreate,
  buildFeedCreate,
  buildFeedNote,
  toDeliverableArticle,
} from './deliver.ts'
import { toCryptoKeyPair } from './keys.ts'
import { isPubliclyVisible } from './object.ts'
import { capabilityTokenFrom, createAurbodaEnricher } from './timeline-enrich.ts'
import { extractNoteImages, noteToTimelineInput } from './timeline-ingest.ts'

/** Posts per outbox page (cursor pagination). */
const OUTBOX_PAGE_SIZE = 20

/** RFC 4122 canonical form — guards `getFeedPostById` from a non-UUID `postId`
 * (Postgres would otherwise raise `invalid input syntax for type uuid`). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The local follower (inbox owner) that an `Accept`/`Reject` response to a Follow
 * WE sent belongs to. Derived from the inner Follow's `actor` (which is our
 * actor), so it works whether the response lands on the personal OR a shared
 * inbox; falls back to `ctx.recipient` (null on the shared inbox) if the remote
 * didn't embed the Follow. `suppressError` so an unresolvable inner object yields
 * null rather than throwing a 500 that invites retries. Returns null if no valid
 * local user can be determined.
 */
const localFollowerIdentifier = async (
  ctx: InboxContext<void>,
  response: Accept | Reject,
): Promise<string | null> => {
  const object = await response.getObject({ suppressError: true })
  if (object instanceof Follow && object.actorId != null) {
    const parsed = ctx.parseUri(object.actorId)
    if (parsed?.type === 'actor' && isValidUsername(parsed.identifier)) return parsed.identifier
  }
  const recipient = ctx.recipient
  return recipient != null && isValidUsername(recipient) ? recipient : null
}

/**
 * Persist an inbound follower and decide whether to accept it now. Auto-accepts
 * unless the target user requires manual approval — but an already *accepted*
 * follower re-sending a Follow stays accepted (a re-delivery never demotes them).
 * Caches the follower's presentation (so the approval UI can show who's asking)
 * and the Follow's id (echoed in a deferred Accept/Reject). Returns the acceptance
 * decision, or null if the target user's DB doesn't exist (a Follow to a
 * nonexistent actor — ignore it) or the sender lacks an id/inbox.
 */
const recordInboundFollow = async (
  user: string,
  sender: Actor,
  followActivityUri: string | null,
): Promise<boolean | null> => {
  if (sender.id == null || sender.inboxId == null) return null
  try {
    const settings = await getUserSettings(user)
    const existing = await getFeedFollowerByActor(user, sender.id.href)
    const accepted = existing?.accepted === true || settings?.manually_approve_followers !== true
    const presentation = await extractActorPresentation(sender)
    await upsertFeedFollower(user, {
      accepted,
      actor_uri: sender.id.href,
      avatar_url: presentation.avatar_url,
      display_name: presentation.display_name,
      follow_activity_uri: followActivityUri,
      handle: presentation.handle,
      inbox_uri: sender.inboxId.href,
      shared_inbox_uri: sender.endpoints?.sharedInbox?.href ?? null,
    })
    return accepted
  } catch (error) {
    if (isMissingDatabase(error)) return null
    throw error
  }
}

/**
 * Ingest one `Note` from an accepted followee into `user`'s home timeline: map it
 * to a timeline entry (author from the cached `feed_following` row, content
 * sanitised), capture its image attachments, best-effort fetch the native Aurboda
 * structured chart, and upsert keyed on the Note's id (so a redelivery or edit
 * replaces in place). `onNewEntry` fires only for a genuinely new row — the
 * on-follow backfill omits it, since its historical posts aren't "new".
 *
 * Shared by inbound `Create`/`Update` delivery and the backfill, so both build a
 * timeline entry identically.
 */
export const ingestNoteForRecipient = async (
  user: string,
  note: Note,
  followee: FeedFollowingRecord,
  enrich: (objectUri: string, token?: string) => Promise<FeedStructured | null>,
  onNewEntry?: (user: string) => void,
): Promise<void> => {
  const input = noteToTimelineInput(note, followee)
  if (input == null) return
  // Capture the Note's image attachments (rendered chart / route map, or a
  // Mastodon photo) so the timeline can show them when there's no native chart.
  const images = await extractNoteImages(note)
  // Best-effort: fetch the native structured payload if this is an Aurboda post
  // (null otherwise). A followers-only post authorizes the fetch with the same
  // capability token embedded in its delivered image URL. Stored on the entry so
  // the web can render a native chart in place of the image.
  const structured = await enrich(input.object_uri, capabilityTokenFrom(images))
  const { inserted } = await upsertTimelineEntry(user, { ...input, images, structured })
  if (inserted) onNewEntry?.(user)
}

/**
 * Ingest a `Create`/`Update` of a `Note` into the recipient's home timeline —
 * but ONLY if the sender is an *accepted* followee (so the timeline can't be
 * injected into by a stranger who delivers to our inbox). Resolves the recipient
 * and the cached followee row, then hands off to `ingestNoteForRecipient`.
 * Best-effort: unresolvable objects and non-Notes are ignored, and a missing DB
 * never 500s (which would invite retries).
 */
const ingestFeedActivity = async (
  ctx: InboxContext<void>,
  activity: Create | Update,
  onNewEntry?: (user: string) => void,
  /** Best-effort fetch of the post's native Aurboda structured data (null if not an Aurboda post). */
  enrich: (objectUri: string, token?: string) => Promise<FeedStructured | null> = async () => null,
): Promise<void> => {
  // The recipient (whose timeline this is) comes from the personal inbox owner.
  // Unlike Accept/Reject there's no inner Follow to derive it from, so this relies
  // on personal-inbox delivery; `ctx.recipient` is null on a shared inbox. That's
  // fine today (the actor advertises no `sharedInbox`), but shared-inbox support
  // would need fanning a single delivery out to every local follower of the actor.
  const me = ctx.recipient
  if (me == null || !isValidUsername(me) || activity.actorId == null) return
  try {
    const follow = await getFeedFollowingByActor(me, activity.actorId.href)
    if (follow == null || !follow.accepted) return
    const object = await activity.getObject({ suppressError: true })
    if (!(object instanceof Note)) return
    await ingestNoteForRecipient(me, object, follow, enrich, onNewEntry)
  } catch (error) {
    if (isMissingDatabase(error)) return
    throw error
  }
}

export const createFeedFederation = (
  origin: string,
  apiBaseUrl: string,
  /** Fire-and-forget: called with the recipient when a genuinely new post is ingested. */
  onNewTimelineEntry?: (user: string) => void,
  /**
   * Fire-and-forget: called with `(recipient, followeeActorUri)` when a follow WE
   * sent becomes accepted, to backfill the followee's recent public posts.
   */
  onFollowAccepted?: (user: string, actorUri: string) => void,
): Federation<void> => {
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    // Pin the canonical origin (the public base URL) so actor ids, WebFinger
    // self-links, inbox/outbox URIs, etc. are always built with the right
    // scheme + host — Mastodon requires https, and reconstructing the scheme
    // from the request yields http behind the TLS-terminating proxy.
    origin,
    // No message queue: `sendActivity` then delivers synchronously (awaits the
    // POST). An in-process queue would need `federation.startQueue()` to drain —
    // which the Express integration doesn't run — so queued activities (e.g. the
    // Create on share) would never send. A persistent Postgres queue + worker is
    // a later reliability slice; synchronous delivery is correct for now.
  })

  // Fetches native structured data (typed metrics + series) for ingested posts
  // that come from Aurboda instances, so the web can render a native chart.
  const enrich = createAurbodaEnricher()

  federation
    .setActorDispatcher('/users/{identifier}', async (ctx, identifier) => {
      if (!isValidUsername(identifier)) return null
      let keys
      try {
        keys = await ctx.getActorKeyPairs(identifier)
      } catch (error) {
        if (isMissingDatabase(error)) return null
        throw error
      }
      if (keys.length === 0) return null
      // Advertise "locked account" when the user requires manual approval, so
      // Mastodon et al. show a follow *request* and hold the follow pending
      // (matching our own inbox behaviour of deferring the Accept).
      const settings = await getUserSettings(identifier)
      return new Person({
        followers: ctx.getFollowersUri(identifier),
        following: ctx.getFollowingUri(identifier),
        // Avatar served on the web host; always resolves (identicon fallback),
        // so remote servers like Mastodon always have an actor icon to show.
        icon: new Image({ url: new URL(`${buildProfileUrl(origin, identifier)}/avatar.png`) }),
        id: ctx.getActorUri(identifier),
        inbox: ctx.getInboxUri(identifier),
        manuallyApprovesFollowers: settings?.manually_approve_followers === true,
        outbox: ctx.getOutboxUri(identifier),
        preferredUsername: identifier,
        publicKey: keys[0].cryptographicKey,
      })
    })
    .setKeyPairsDispatcher(async (_ctx, identifier) => {
      if (!isValidUsername(identifier)) return []
      try {
        const kp = await getOrCreateActorKeyPair(identifier)
        return [await toCryptoKeyPair(kp.private_key_pem, kp.public_key_pem)]
      } catch (error) {
        if (isMissingDatabase(error)) return []
        throw error
      }
    })
    .mapHandle((_ctx, username) => (isValidUsername(username) ? username : null))

  // Inbound inbox. Fedify verifies the HTTP Signature before invoking these
  // handlers, so a request that reaches `.on(...)` is authenticated as the
  // sending actor. Unregistered activity types are silently ignored.
  federation
    .setInboxListeners('/users/{identifier}/inbox', '/inbox')
    .on(Follow, async (ctx, follow) => {
      // The Follow must target one of our actors.
      if (follow.objectId == null) return
      const target = ctx.parseUri(follow.objectId)
      if (target?.type !== 'actor' || !isValidUsername(target.identifier)) return

      const sender = await follow.getActor(ctx)
      if (sender?.id == null || sender.inboxId == null) return

      const accepted = await recordInboundFollow(target.identifier, sender, follow.id?.href ?? null)
      // In manual-approval mode a new/pending follow gets no Accept yet — the
      // owner approves it later (which sends the Accept). `null` means no such
      // user (missing DB). Only an accepted follow is answered now, so the remote
      // server marks it established.
      if (accepted !== true) return
      await ctx.sendActivity(
        { identifier: target.identifier },
        sender,
        new Accept({ actor: follow.objectId, object: follow }),
      )
    })
    .on(Undo, async (ctx, undo) => {
      // Undo{Follow} — drop the follower. `suppressError` so an unresolvable
      // inner object (e.g. a bare Follow URI the remote 404s after unfollowing)
      // yields null and is ignored, rather than throwing a 500 that invites
      // retries. Mastodon embeds the full Follow, so the common case resolves.
      const object = await undo.getObject({ suppressError: true })
      if (!(object instanceof Follow) || object.objectId == null || undo.actorId == null) return
      const target = ctx.parseUri(object.objectId)
      if (target?.type !== 'actor' || !isValidUsername(target.identifier)) return
      try {
        await removeFeedFollower(target.identifier, undo.actorId.href)
      } catch (error) {
        if (isMissingDatabase(error)) return
        throw error
      }
    })
    .on(Accept, async (ctx, accept) => {
      // Accept of a Follow WE sent — the followee's server confirms the follow.
      // `accept.actorId` is the followee we followed, matching the `actor_uri` of
      // our pending row.
      const me = await localFollowerIdentifier(ctx, accept)
      if (me == null || accept.actorId == null) return
      try {
        await markFeedFollowingAccepted(me, accept.actorId.href)
      } catch (error) {
        if (isMissingDatabase(error)) return
        throw error
      }
      // The follow is now established → backfill the followee's recent public
      // posts so the timeline isn't empty until they next post. Fire-and-forget
      // (a slow/large outbox must never block inbox processing), and after the
      // accept is durably recorded. Covers remote *and* local follows: a local
      // followee's auto-Accept loops back through this same handler.
      onFollowAccepted?.(me, accept.actorId.href)
    })
    .on(Reject, async (ctx, reject) => {
      // Reject of a Follow we sent — the followee declined; drop our pending row.
      const me = await localFollowerIdentifier(ctx, reject)
      if (me == null || reject.actorId == null) return
      try {
        await removeFeedFollowingByActor(me, reject.actorId.href)
      } catch (error) {
        if (isMissingDatabase(error)) return
        throw error
      }
    })
    // Create / Update of a Note from an actor we follow → ingest into our home
    // timeline. Update reuses the same upsert (keyed on the Note's object id), so
    // an edit replaces the stored copy. Only *accepted* followees are ingested, so
    // a stranger who somehow delivers here can't inject into the timeline.
    .on(Create, (ctx, create) => ingestFeedActivity(ctx, create, onNewTimelineEntry, enrich))
    .on(Update, (ctx, update) => ingestFeedActivity(ctx, update, onNewTimelineEntry, enrich))
    .on(Delete, async (ctx, del) => {
      // Delete of a post we received → drop it from the timeline. `del.objectId`
      // is the removed object's id (a Tombstone or bare id); we key on it, but
      // scope the delete to the sender (`del.actorId`) so a signed `Delete` from
      // some other actor can't evict a post it didn't author — mirroring how
      // `Undo{Follow}` is scoped to its own actor.
      const me = ctx.recipient
      if (me == null || !isValidUsername(me) || del.objectId == null || del.actorId == null) return
      try {
        await deleteTimelineEntryByUri(me, del.objectId.href, del.actorId.href)
      } catch (error) {
        if (isMissingDatabase(error)) return
        throw error
      }
    })

  // Individual post object. Serves the same `Note` that was delivered, at its
  // canonical id, so a remote server can dereference it. Only `public`/`unlisted`
  // objects resolve — `followers`-only posts are delivered with the object
  // inline, so their id never needs to be fetched; refusing them keeps
  // follower-only content off an unauthenticated fetch.
  federation.setObjectDispatcher(
    Note,
    '/users/{identifier}/feed/{postId}',
    async (ctx, { identifier, postId }) => {
      if (!isValidUsername(identifier) || !UUID_RE.test(postId)) return null
      let post
      try {
        post = await getFeedPostById(identifier, postId)
      } catch (error) {
        if (isMissingDatabase(error)) return null
        throw error
      }
      if (post == null || post.activity_id == null || !isPubliclyVisible(post.visibility)) return null
      // Resolve the merged-span activity so the served Note matches what the user
      // shared (and what we delivered), not just the anchor sub-activity (#881).
      const activity = await resolveFeedActivity(identifier, post.activity_id)
      if (activity == null) return null
      return buildFeedNote(ctx, identifier, post, activity, apiBaseUrl)
    },
  )

  // Individual article object, served at its own path (distinct from the Note
  // dispatcher above) as an AS2 `Article`. Same public/unlisted-only gate: a
  // `followers`-only article is delivered with its object inline, so its id never
  // needs an unauthenticated fetch.
  federation.setObjectDispatcher(
    Article,
    '/users/{identifier}/feed/{postId}/article',
    async (ctx, { identifier, postId }) => {
      if (!isValidUsername(identifier) || !UUID_RE.test(postId)) return null
      let post
      try {
        post = await getFeedPostById(identifier, postId)
      } catch (error) {
        if (isMissingDatabase(error)) return null
        throw error
      }
      if (post == null || !isPubliclyVisible(post.visibility)) return null
      const article = toDeliverableArticle(post)
      return article == null ? null : buildFeedArticle(ctx, identifier, article, apiBaseUrl)
    },
  )

  // Outbox: the user's public + unlisted posts as `Create` activities, so a
  // Mastodon profile shows them. Cursor-paginated (`OUTBOX_PAGE_SIZE` per page)
  // so an unauthenticated fetch never resolves every post's scalars at once; the
  // cursor is a simple offset (a concurrent share can shift a page boundary —
  // acceptable for an occasionally-crawled outbox). A post whose activity was
  // soft-deleted is skipped from the items while `setCounter` still counts it;
  // the divergence self-heals when the stale post is removed.
  federation
    .setOutboxDispatcher('/users/{identifier}/outbox', async (ctx, identifier, cursor) => {
      if (!isValidUsername(identifier)) return null
      const offset = cursor == null ? 0 : Number.parseInt(cursor, 10)
      // `isSafeInteger` also rejects absurd offsets (e.g. a crafted `1e20`) that
      // would overflow Postgres `bigint` in `OFFSET` and 500 the request.
      if (!Number.isSafeInteger(offset) || offset < 0) return null
      let posts
      try {
        posts = await listPublicFeedPostsPage(identifier, OUTBOX_PAGE_SIZE, offset)
      } catch (error) {
        if (isMissingDatabase(error)) return null
        throw error
      }
      const items = (
        await Promise.all(
          posts.map(async (post) => {
            // Articles federate as `Create{Article}` (no linked activity); every
            // other post as `Create{Note}` from its resolved activity.
            const article = toDeliverableArticle(post)
            if (article != null) return buildFeedArticleCreate(ctx, identifier, article, apiBaseUrl)
            if (post.activity_id == null) return null
            const activity = await resolveFeedActivity(identifier, post.activity_id)
            return activity == null ? null : buildFeedCreate(ctx, identifier, post, activity, apiBaseUrl)
          }),
        )
      ).filter((item): item is Create => item != null)
      const nextCursor = posts.length === OUTBOX_PAGE_SIZE ? String(offset + OUTBOX_PAGE_SIZE) : null
      return { items, nextCursor }
    })
    .setCounter(async (_ctx, identifier) => {
      if (!isValidUsername(identifier)) return 0
      try {
        return await countPublicFeedPosts(identifier)
      } catch (error) {
        if (isMissingDatabase(error)) return 0
        throw error
      }
    })
    .setFirstCursor((_ctx, identifier) => (isValidUsername(identifier) ? '0' : null))
    .setLastCursor(async (_ctx, identifier) => {
      if (!isValidUsername(identifier)) return null
      try {
        const count = await countPublicFeedPosts(identifier)
        // Offset of the last page; '0' for an empty or single-page outbox.
        return count <= OUTBOX_PAGE_SIZE
          ? '0'
          : String(Math.floor((count - 1) / OUTBOX_PAGE_SIZE) * OUTBOX_PAGE_SIZE)
      } catch (error) {
        if (isMissingDatabase(error)) return null
        throw error
      }
    })

  // Real followers, backed by feed_follower. This both serves the followers
  // collection and enumerates recipients for `sendActivity(..., 'followers', …)`.
  federation
    .setFollowersDispatcher('/users/{identifier}/followers', async (_ctx, identifier) => {
      if (!isValidUsername(identifier)) return { items: [] }
      try {
        // Only *accepted* followers are published + delivered to (a pending
        // request isn't a confirmed follower and gets no `followers`-only posts).
        const followers = await listFeedFollowers(identifier, { accepted: true })
        return {
          items: followers.map((f) => ({
            endpoints: f.shared_inbox_uri ? { sharedInbox: new URL(f.shared_inbox_uri) } : null,
            id: new URL(f.actor_uri),
            inboxId: new URL(f.inbox_uri),
          })),
        }
      } catch (error) {
        if (isMissingDatabase(error)) return { items: [] }
        throw error
      }
    })
    .setCounter(async (_ctx, identifier) => {
      if (!isValidUsername(identifier)) return 0
      try {
        return await countFeedFollowers(identifier)
      } catch (error) {
        if (isMissingDatabase(error)) return 0
        throw error
      }
    })

  // The actors this user follows, backed by feed_following. Only *accepted*
  // follows are published (a pending follow isn't a confirmed relationship yet).
  // Items are the followees' actor URIs.
  federation
    .setFollowingDispatcher('/users/{identifier}/following', async (_ctx, identifier) => {
      if (!isValidUsername(identifier)) return { items: [] }
      try {
        const following = await listAcceptedFeedFollowing(identifier)
        return { items: following.map((f) => new URL(f.actor_uri)) }
      } catch (error) {
        if (isMissingDatabase(error)) return { items: [] }
        throw error
      }
    })
    .setCounter(async (_ctx, identifier) => {
      if (!isValidUsername(identifier)) return 0
      try {
        return await countAcceptedFeedFollowing(identifier)
      } catch (error) {
        if (isMissingDatabase(error)) return 0
        throw error
      }
    })

  return federation
}
