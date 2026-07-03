import { createFederation, type Federation, MemoryKvStore } from '@fedify/fedify'
import { Accept, type Create, Follow, Image, Note, Person, Undo } from '@fedify/fedify/vocab'

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
 * - inbound inbox: `Follow` → persist follower + `Accept`; `Undo{Follow}` →
 *   drop the follower (Fedify verifies the HTTP Signature first).
 *
 * Delivery is synchronous (no message queue — see `createFeedFederation`); a
 * persistent Postgres queue for retried, durable delivery is a later slice.
 */
import { isValidUsername } from '../../api/auth-routes.ts'
import {
  countFeedFollowers,
  countPublicFeedPosts,
  getFeedPostById,
  getOrCreateActorKeyPair,
  isMissingDatabase,
  listFeedFollowers,
  listPublicFeedPostsPage,
  removeFeedFollower,
  upsertFeedFollower,
} from '../../db/index.ts'
import { resolveFeedActivity } from '../feed.ts'
import { buildProfileUrl } from '../share-urls.ts'
import { buildFeedCreate, buildFeedNote } from './deliver.ts'
import { toCryptoKeyPair } from './keys.ts'
import { isPubliclyVisible } from './object.ts'

/** Posts per outbox page (cursor pagination). */
const OUTBOX_PAGE_SIZE = 20

/** RFC 4122 canonical form — guards `getFeedPostById` from a non-UUID `postId`
 * (Postgres would otherwise raise `invalid input syntax for type uuid`). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const createFeedFederation = (origin: string, apiBaseUrl: string): Federation<void> => {
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
      return new Person({
        followers: ctx.getFollowersUri(identifier),
        // Avatar served on the web host; always resolves (identicon fallback),
        // so remote servers like Mastodon always have an actor icon to show.
        icon: new Image({ url: new URL(`${buildProfileUrl(origin, identifier)}/avatar.png`) }),
        id: ctx.getActorUri(identifier),
        inbox: ctx.getInboxUri(identifier),
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

      try {
        await upsertFeedFollower(target.identifier, {
          accepted: true,
          actor_uri: sender.id.href,
          inbox_uri: sender.inboxId.href,
          shared_inbox_uri: sender.endpoints?.sharedInbox?.href ?? null,
        })
      } catch (error) {
        // A syntactically-valid username with no database is a Follow to a
        // nonexistent actor — ignore it (don't 500 and invite retries), and
        // don't answer with an Accept.
        if (isMissingDatabase(error)) return
        throw error
      }

      // Answer the Follow so the remote server marks it established.
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
        const followers = await listFeedFollowers(identifier)
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

  return federation
}
