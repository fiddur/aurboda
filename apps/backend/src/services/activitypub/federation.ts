import { createFederation, type Federation, InProcessMessageQueue, MemoryKvStore } from '@fedify/fedify'
import { Person } from '@fedify/fedify/vocab'

/**
 * The Fedify `Federation` object for the activity feed.
 *
 * Single actor per user: the actor identifier IS the username, and the actor
 * lives at `<host>/u/<username>` — consistent with the shared-dashboard /
 * challenge identity model and the AS2 object model. This slice wires the
 * read/discovery surface only:
 *
 * - actor document (`Person`) with the user's published RSA public key,
 * - WebFinger (`acct:<user>@<host>` → the actor), via `mapHandle`,
 * - key-pairs dispatcher backed by the per-user `feed_actor` keypair.
 *
 * Inbound inbox handling + HTTP-signature verification and outbound delivery are
 * layered on in later slices. The in-memory KV/queue here are fine for the
 * read-only surface; a persistent (Postgres) backing lands with delivery.
 */
import { isValidUsername } from '../../api/auth-routes.ts'
import { getOrCreateActorKeyPair, isMissingDatabase } from '../../db/index.ts'
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

  // Register the inbox path so the actor can advertise inbox/shared-inbox URIs.
  // Inbound handling (Follow→Accept, signature verification) is a later slice —
  // for now the inbox simply accepts and ignores.
  federation.setInboxListeners('/users/{identifier}/inbox', '/inbox')

  // Empty collections for now; the outbox serves the user's public posts once
  // delivery wiring exists.
  federation.setOutboxDispatcher('/users/{identifier}/outbox', (_ctx, _identifier) => ({ items: [] }))
  federation.setFollowersDispatcher('/users/{identifier}/followers', (_ctx, _identifier) => ({
    items: [],
  }))

  return federation
}
