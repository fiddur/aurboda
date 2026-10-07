/**
 * Content negotiation for the actor URL `/users/:username` (RFC 9110 §12.5.1).
 * Its two representations are the ActivityPub actor document and, for a human,
 * the public profile page the SPA serves at `/u/:username` (a 302).
 *
 * Fedify serves the actor only to a request that NAMES an ActivityPub type and
 * `next()`s everything else, so a wildcard or absent `Accept` — which by the
 * spec accepts any representation — would fall through to a 404 as though the
 * account didn't exist. `createActorAcceptNormalizer`, mounted BEFORE the
 * Fedify integration, rewrites such a request's `Accept` to the actor type so
 * Fedify answers it. `createActorHtmlRouter`, mounted AFTER it, redirects a
 * request whose best match is HTML and answers `406` when an existing actor has
 * no acceptable representation. An unknown actor falls through to its 404 in
 * every case.
 */
import { Router, type RequestHandler } from 'express'

import { isValidUsername } from '../api/auth-routes.ts'
import { buildProfileUrl } from '../services/share-urls.ts'

export interface ActorHtmlDeps {
  /** Canonical web origin, e.g. `https://aurboda.net` — the profile URL base. */
  origin: string
  /** Whether the account exists on this instance (unknown users must not redirect). */
  userExists: (username: string) => Promise<boolean>
}

const AP_TYPES = ['application/activity+json', 'application/ld+json']
const HTML_TYPES = ['text/html', 'application/xhtml+xml']
const ACTOR_TYPE = 'application/activity+json'
const ACTOR_PATH = /^\/users\/([^/]+)$/

/** One `Accept` entry: its media type (lowercased) and quality weight. */
const parseAcceptEntry = (raw: string): { type: string; q: number } => {
  const [type, ...params] = raw.split(';').map((part) => part.trim())
  const qParam = params.find((param) => param.toLowerCase().startsWith('q='))
  const q = qParam == null ? 1 : Number(qParam.slice(2))
  return { q: Number.isFinite(q) ? q : 0, type: type.toLowerCase() }
}

export type ActorRepresentation = 'activitypub' | 'html' | 'none'

/**
 * Which representation of the actor to serve. Each one is weighted by the most
 * specific matching range (exact type, then `type/*`, then the full wildcard); an absent
 * header accepts anything. The higher weight wins. On a tie the actor document
 * is the default — unless the request names an HTML type outright, which is
 * what a browser navigation does (`text/html,…;q=0.8` with a full wildcard last).
 */
export const negotiateActor = (acceptHeader: string | undefined): ActorRepresentation => {
  if (acceptHeader == null || acceptHeader.trim() === '') return 'activitypub'
  const entries = acceptHeader.split(',').map(parseAcceptEntry)
  const weight = (types: string[]): { q: number; explicit: boolean } => {
    const exact = entries.filter((entry) => types.includes(entry.type))
    if (exact.length > 0) return { explicit: true, q: Math.max(...exact.map((entry) => entry.q)) }
    const families = new Set(types.map((type) => `${type.split('/')[0]}/*`))
    const family = entries.filter((entry) => families.has(entry.type))
    if (family.length > 0) return { explicit: false, q: Math.max(...family.map((entry) => entry.q)) }
    const any = entries.filter((entry) => entry.type === '*/*')
    return { explicit: false, q: any.length > 0 ? Math.max(...any.map((entry) => entry.q)) : 0 }
  }
  const html = weight(HTML_TYPES)
  const ap = weight(AP_TYPES)
  if (html.q === 0 && ap.q === 0) return 'none'
  if (html.q > ap.q || (html.q === ap.q && html.explicit)) return 'html'
  return 'activitypub'
}

/**
 * Hand a request whose best representation is the actor document to Fedify
 * with the `Accept` it recognises. Only the bare actor path: its sub-resources
 * (outbox, posts) negotiate on their own.
 */
export const createActorAcceptNormalizer = (): RequestHandler => (req, res, next) => {
  const match = ACTOR_PATH.exec(req.path)
  if ((req.method === 'GET' || req.method === 'HEAD') && match && isValidUsername(match[1])) {
    res.setHeader('Vary', 'Accept')
    if (negotiateActor(req.headers.accept) === 'activitypub') req.headers.accept = ACTOR_TYPE
  }
  next()
}

export const createActorHtmlRouter = (deps: ActorHtmlDeps): Router => {
  const router = Router()

  router.get('/users/:username', (req, res, next) => {
    const { username } = req.params
    if (!isValidUsername(username)) return next()
    const representation = negotiateActor(req.headers.accept)
    if (representation === 'activitypub') return next()
    void deps
      .userExists(username)
      .then((exists) => {
        if (!exists) return next()
        // The answer depends on the Accept header, so a shared cache must not
        // serve it to a client asking for the same URL with another one.
        res.setHeader('Vary', 'Accept')
        if (representation === 'html') return res.redirect(302, buildProfileUrl(deps.origin, username))
        res.status(406).json({ accepts: [ACTOR_TYPE, ...HTML_TYPES], error: 'Not Acceptable' })
      })
      .catch(next)
  })

  return router
}
