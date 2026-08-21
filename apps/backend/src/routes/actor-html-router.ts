/**
 * Browser-facing fallback for ActivityPub actor URLs (#1047).
 *
 * Handles: GET /users/:username with an HTML-preferring Accept header.
 *
 * Fedify's actor dispatcher content-negotiates: an ActivityPub client gets the
 * actor document, but a browser (`Accept: text/html`) makes `@fedify/express`
 * fall through (`next()`) and then answer `406 Not acceptable` — unless a later
 * Express route claims the request. This router — mounted right AFTER
 * `integrateFederation`, like the feed tombstone router — is that route: it
 * redirects a human clicking an actor link (e.g. from a Mastodon profile that
 * didn't use the actor's `url` property) to the public profile page the SPA
 * serves at `/u/:username`.
 *
 * Anything that is not an HTML request for a well-formed username falls
 * through untouched, so an ActivityPub fetch of a nonexistent actor still ends
 * in the plain 404, never a redirect to a 200 HTML page.
 */
import { Router } from 'express'

import { isValidUsername } from '../api/auth-routes.ts'
import { buildProfileUrl } from '../services/share-urls.ts'

export interface ActorHtmlDeps {
  /** Canonical web origin, e.g. `https://aurboda.net` — the profile URL base. */
  origin: string
}

export const createActorHtmlRouter = (deps: ActorHtmlDeps): Router => {
  const router = Router()

  router.get('/users/:username', (req, res, next) => {
    if (!isValidUsername(req.params.username)) return next()
    // `accepts` honours quality values, so a browser's
    // `text/html,application/xhtml+xml,…` prefers html while an ActivityPub
    // client's `application/activity+json` (or a bare `Accept: */*` already
    // answered by Fedify before this router runs) does not.
    if (!req.accepts('html')) return next()
    res.redirect(302, buildProfileUrl(deps.origin, req.params.username))
  })

  return router
}
