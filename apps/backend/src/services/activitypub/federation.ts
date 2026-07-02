import { createFederation, type Federation, InProcessMessageQueue, MemoryKvStore } from '@fedify/fedify'
import { Accept, Follow, Person, Undo } from '@fedify/fedify/vocab'

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
 * Outbound delivery of the user's own posts is a later slice. The in-memory
 * KV/queue are fine here (Accept is sent inline); a persistent (Postgres)
 * backing lands with reliable delivery.
 */
import { isValidUsername } from '../../api/auth-routes.ts'
import {
  getOrCreateActorKeyPair,
  isMissingDatabase,
  removeFeedFollower,
  upsertFeedFollower,
} from '../../db/index.ts'
import { toCryptoKeyPair } from './keys.ts'

export const createFeedFederation = (): Federation<void> => {
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    queue: new InProcessMessageQueue(),
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
      // Undo{Follow} — drop the follower.
      const object = await undo.getObject()
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

  // Empty collections for now; the outbox serves the user's public posts once
  // delivery wiring exists.
  federation.setOutboxDispatcher('/users/{identifier}/outbox', (_ctx, _identifier) => ({ items: [] }))
  federation.setFollowersDispatcher('/users/{identifier}/followers', (_ctx, _identifier) => ({
    items: [],
  }))

  return federation
}
