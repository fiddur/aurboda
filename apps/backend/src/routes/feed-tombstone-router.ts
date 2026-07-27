/**
 * `410 Gone` Tombstone for deleted feed-post objects (UNAUTHENTICATED).
 *
 * Handles: GET /users/:username/feed/:postId          (deleted activity `Note`)
 *          GET /users/:username/feed/:postId/article  (deleted `Article`)
 *
 * A shared post's object row is hard-deleted on unshare, so Fedify's object
 * dispatcher returns `null` and `@fedify/express` falls through (`next()`). This
 * router — mounted right AFTER `integrateFederation` — catches that fall-through:
 * if the id is a recorded tombstone (a since-deleted `public`/`unlisted` post) it
 * answers `410 Gone` with an AS2 `Tombstone`, which tells a remote server the
 * object is *permanently* gone (vs a `404`, which reads as transient/unknown).
 * Anything without a tombstone — a live post (served by Fedify, never reaches
 * here), a `followers`-only id, or one that never existed — falls through to the
 * normal 404.
 *
 * Fedify's `handleObject` serialises a returned `Tombstone` as `200`, so the 410
 * can't come from the dispatcher; the Express layer is the only place to set it.
 */
import { type RequestHandler, type Response, Router } from 'express'

import { isValidUsername } from '../api/auth-routes.ts'
import { isMissingDatabase } from '../db/index.ts'

/** RFC 4122 canonical form — mirrors the object dispatcher's guard. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface FeedTombstoneDeps {
  /** Canonical web origin, e.g. `https://aurboda.net` — the Tombstone `id` base. */
  origin: string
  getTombstone: (user: string, postId: string) => Promise<{ deleted_at: Date } | null>
}

/** The AS2 type a tombstoned object formerly had (`Note` for an activity share, `Article` for an article). */
export type TombstoneFormerType = 'Article' | 'Note'

/**
 * The AS2 `Tombstone` JSON-LD served at a deleted object's id. `id` mirrors the
 * object dispatcher's canonical id (`<origin>/users/<user>/feed/<postId>` for a
 * `Note`, `…/article` for an `Article`); `formerType`/`deleted` are the standard
 * Tombstone descriptors.
 */
export const buildTombstoneJsonLd = (
  id: string,
  deletedAt: Date,
  formerType: TombstoneFormerType = 'Note',
) => ({
  '@context': 'https://www.w3.org/ns/activitystreams',
  deleted: deletedAt.toISOString(),
  formerType,
  id,
  type: 'Tombstone',
})

const sendTombstone = (
  res: Response,
  id: string,
  deletedAt: Date,
  formerType: TombstoneFormerType = 'Note',
) => {
  // Match the object endpoint: no caching, so a re-share at a new id (or any
  // future change) is never served stale.
  res.setHeader('Cache-Control', 'no-store')
  res
    .status(410)
    .type('application/activity+json')
    .send(JSON.stringify(buildTombstoneJsonLd(id, deletedAt, formerType)))
}

export const createFeedTombstoneRouter = (deps: FeedTombstoneDeps): Router => {
  const base = deps.origin.replace(/\/+$/, '')
  const router = Router()

  // One tombstone row (recorded per postId on delete) backs both the `Note` id
  // and the `Article` id — the path suffix selects which object was tombstoned
  // and its `formerType`. A remote server only ever dereferences the `…/article`
  // id for an actual article (it received a `Create{Article}` at that id).
  const tombstoneHandler =
    (suffix: string, formerType: TombstoneFormerType): RequestHandler<{ postId: string; username: string }> =>
    async (req, res, next) => {
      const { postId, username } = req.params
      if (!isValidUsername(username) || !UUID_RE.test(postId)) return next()
      let tombstone: { deleted_at: Date } | null
      try {
        tombstone = await deps.getTombstone(username, postId)
      } catch (error) {
        // A syntactically-valid username with no database is not a tombstone.
        if (isMissingDatabase(error)) return next()
        throw error
      }
      if (tombstone == null) return next()
      // isValidUsername guarantees URL-safe chars, so no encoding needed to match
      // the dispatcher's `getObjectUri(…)` output exactly.
      sendTombstone(
        res,
        `${base}/users/${username}/feed/${postId}${suffix}`,
        tombstone.deleted_at,
        formerType,
      )
    }

  router.get('/users/:username/feed/:postId', tombstoneHandler('', 'Note'))
  router.get('/users/:username/feed/:postId/article', tombstoneHandler('/article', 'Article'))

  return router
}
