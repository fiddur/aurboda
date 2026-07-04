/**
 * Gate the `@fedify/express` integration so it only runs for the routes Fedify
 * actually owns.
 *
 * `integrateFederation` must be mounted BEFORE `express.json()` so Fedify sees
 * the raw body of signed inbox POSTs. But its `fromERequest` wraps EVERY
 * non-GET request body with `Readable.toWeb(req)` — even for routes it doesn't
 * own — and then calls `next()` without ever consuming that stream. The result:
 * `express.json()` waits forever for body bytes that were siphoned into an
 * abandoned web stream, so any non-federation POST whose body exceeds the
 * socket buffer (~64 KB) hangs with no response (e.g. a large Health Connect
 * batch — see the size-cliff regression test).
 *
 * Restricting the middleware to federation-owned paths keeps raw-body access
 * for the inbox while letting every other route reach `express.json()`
 * untouched.
 */
import type { RequestHandler } from 'express'

/**
 * Whether `path` is served by the Fedify federation surface (see
 * `services/activitypub/federation.ts`): the per-user actor and everything
 * mounted under it (inbox, outbox, followers, following, feed objects), the
 * shared inbox, and WebFinger / NodeInfo discovery.
 *
 * Must stay a superset of every dispatcher/listener path registered on the
 * federation object — a missed path would silently stop reaching Fedify.
 */
export const isFederationRequest = (path: string): boolean =>
  path === '/inbox' ||
  path.startsWith('/users/') ||
  path.startsWith('/.well-known/webfinger') ||
  path.startsWith('/.well-known/nodeinfo') ||
  path.startsWith('/nodeinfo')

/** Wrap the Fedify middleware so non-federation requests skip it entirely. */
export const gateFederation =
  (federation: RequestHandler): RequestHandler =>
  (req, res, next) =>
    isFederationRequest(req.path) ? federation(req, res, next) : next()
