/**
 * Public feed-post image endpoints (UNAUTHENTICATED).
 *
 * Handles: GET /public/:username/feed/:postId/chart.png
 *          GET /public/:username/feed/:postId/route.png
 *
 * Rendered on demand from the shared activity's data. Like the public `/series`
 * endpoint there is no auth token, so the gating below is the whole privacy
 * boundary: an image is served only for a `public`/`unlisted` post that opted
 * into that attachment (`include_chart` / `include_map`). `no-store` keeps the
 * images revocable (unshare / flip to followers / clear the flag takes effect
 * immediately). Mounted before the generic `/public/:username/:slug` resolver.
 */
import { type Response, Router } from 'express'

import type { FeedPostRecord } from '../db/index.ts'

import { isValidUsername } from '../api/auth-routes.ts'
import { isMissingDatabase } from '../db/index.ts'
import { isPubliclyVisible } from '../services/activitypub/object.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The window an image renders over. */
export interface ImageActivity {
  start_time: Date
  end_time?: Date
}

export interface FeedImageDeps {
  getPost: (user: string, postId: string) => Promise<FeedPostRecord | null>
  getActivity: (user: string, activityId: string) => Promise<ImageActivity | null>
  getSeries: (user: string, metric: string, start: Date, end: Date) => Promise<[Date, number][]>
  getRoute: (user: string, start: Date, end: Date) => Promise<[number, number][]>
  renderChart: (series: [Date, number][]) => Promise<Buffer>
  renderRoute: (coords: [number, number][]) => Promise<Buffer>
}

/**
 * A tiny memoising render cache with in-flight de-duplication (mirrors
 * og-image-router): repeated fetches for the same image serve a cached buffer,
 * and concurrent misses collapse to a single render. Rendering is CPU-heavy and
 * the source data (a past activity's series/GPS) is effectively immutable, so a
 * bounded LRU + process-restart eviction is enough. `produce` returning `null`
 * (no data) is NOT cached. The caller checks eligibility BEFORE consulting this,
 * so an unshared/visibility-changed post 404s and never reaches the cache.
 */
export const createRenderCache = (maxEntries = 200) => {
  const cache = new Map<string, Buffer>()
  const inFlight = new Map<string, Promise<Buffer | null>>()
  return async (key: string, produce: () => Promise<Buffer | null>): Promise<Buffer | null> => {
    const cached = cache.get(key)
    if (cached) return cached
    const pending = inFlight.get(key)
    if (pending) return pending
    const promise = produce()
    inFlight.set(key, promise)
    try {
      const png = await promise
      if (png) {
        if (cache.size >= maxEntries) {
          const oldest = cache.keys().next().value
          if (oldest !== undefined) cache.delete(oldest)
        }
        cache.set(key, png)
      }
      return png
    } finally {
      inFlight.delete(key)
    }
  }
}

/**
 * Resolve the activity window an image may render over, or `null` if the request
 * isn't eligible: invalid username / non-UUID id, missing DB, missing or
 * non-public post, the attachment flag not opted in, no linked activity, or an
 * open-ended activity (no bounded window). Pure of Express — unit-testable.
 */
export const resolveImageWindow = async (
  deps: Pick<FeedImageDeps, 'getPost' | 'getActivity'>,
  username: string,
  postId: string,
  flag: 'include_chart' | 'include_map',
): Promise<ImageActivity | null> => {
  if (!isValidUsername(username) || !UUID_RE.test(postId)) return null
  let post: FeedPostRecord | null
  try {
    post = await deps.getPost(username, postId)
  } catch (error) {
    if (isMissingDatabase(error)) return null
    throw error
  }
  if (post == null || !isPubliclyVisible(post.visibility) || !post[flag] || post.activity_id == null) {
    return null
  }
  const activity = await deps.getActivity(username, post.activity_id)
  if (activity?.end_time == null) return null
  return activity
}

const notFound = (res: Response) => res.status(404).json({ error: 'Not found', success: false })

const sendPng = (res: Response, png: Buffer) => {
  // Revocable like the /series endpoint: never let a shared cache serve an image
  // for a post that was just un-shared.
  res.setHeader('Cache-Control', 'no-store')
  res.type('png').send(png)
}

export const createFeedImageRouter = (deps: FeedImageDeps): Router => {
  const router = Router()
  const cached = createRenderCache()

  router.get('/public/:username/feed/:postId/chart.png', async (req, res) => {
    const { postId, username } = req.params
    const activity = await resolveImageWindow(deps, username, postId, 'include_chart')
    if (!activity?.end_time) return notFound(res)
    const { end_time, start_time } = activity
    const png = await cached(`chart:${username}:${postId}`, async () => {
      const series = await deps.getSeries(username, 'heart_rate', start_time, end_time)
      return series.length === 0 ? null : deps.renderChart(series)
    })
    if (!png) return notFound(res)
    sendPng(res, png)
  })

  router.get('/public/:username/feed/:postId/route.png', async (req, res) => {
    const { postId, username } = req.params
    const activity = await resolveImageWindow(deps, username, postId, 'include_map')
    if (!activity?.end_time) return notFound(res)
    const { end_time, start_time } = activity
    const png = await cached(`route:${username}:${postId}`, async () => {
      const coords = await deps.getRoute(username, start_time, end_time)
      return coords.length === 0 ? null : deps.renderRoute(coords)
    })
    if (!png) return notFound(res)
    sendPng(res, png)
  })

  return router
}
