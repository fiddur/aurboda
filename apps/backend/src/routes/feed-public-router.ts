/**
 * Public feed read surface (UNAUTHENTICATED).
 *
 * Handles: GET /public/:username/series
 *
 * Returns bucketed samples for a single metric over a window — but ONLY when a
 * feed post explicitly shared that metric as a series for an activity whose
 * window covers the request. There is no auth token (this is deliberately
 * public, like a shared-dashboard slug), so the data-driven scoping in
 * `resolvePublicSeries` is the entire privacy boundary. Unshared metrics and
 * out-of-window ranges 404.
 *
 * Mounted BEFORE the generic `/public/:username/:slug` resolver so `series` is
 * never mistaken for a share slug.
 */
import {
  type FeedPostStructuredResponse,
  type PublicSeriesQuery,
  publicSeriesQuerySchema,
  type PublicSeriesResponse,
} from '@aurboda/api-spec'

import { isValidUsername } from '../api/auth-routes.ts'
import { findCoveringSharedSeriesWindow, isMissingDatabase } from '../db/index.ts'
import { resolvePublicSeries } from '../services/feed-series.ts'
import { resolveStructuredPost } from '../services/feed-structured.ts'
import { queryMetricsBucketed } from '../services/queries/index.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const createFeedPublicRouter = (): TypedRouter => {
  const router = typedRouter()

  router.get<{ username: string }, PublicSeriesResponse, unknown, PublicSeriesQuery>(
    '/public/:username/series',
    validateQuery(publicSeriesQuerySchema),
    async (req, res) => {
      const { username } = req.params
      if (!isValidUsername(username)) {
        return res.status(404).json({ error: 'Not found', success: false })
      }
      const { bucket, end, metric, start } = req.query
      try {
        const result = await resolvePublicSeries(metric, new Date(start), new Date(end), bucket, {
          findCoveringWindow: (m, s, e) => findCoveringSharedSeriesWindow(username, m, s, e),
          queryBucketed: (m, s, e, b) => queryMetricsBucketed(username, [m], s, e, b, {}),
        })
        if (!result) {
          return res.status(404).json({ error: 'Not found', success: false })
        }
        // `no-store`: sharing is revocable (delete the post, flip it to
        // `followers`, or drop the metric from `series_metrics`) and must take
        // effect immediately, so shared caches/CDNs must never serve a series
        // that was just un-shared.
        res.setHeader('Cache-Control', 'no-store')
        res.json({ ...result, success: true })
      } catch (error) {
        if (isMissingDatabase(error)) {
          return res.status(404).json({ error: 'Not found', success: false })
        }
        throw error
      }
    },
  )

  // The native structured post (typed metrics + inline series) another Aurboda
  // instance fetches on ingest to render a chart. Same data-scoping as `/series`
  // and only the metrics/series actually shared. `public`/`unlisted` resolve
  // unconditionally; a `followers`-only post resolves only with a matching
  // capability `?token=` (the same token that authorizes its followers-only
  // images), so an accepted follower's instance can render the native chart.
  // `no-store` for the same revocability reason as the series endpoint.
  router.get<{ username: string; postId: string }, FeedPostStructuredResponse, unknown, { token?: string }>(
    '/public/:username/feed/:postId',
    async (req, res) => {
      const { postId, username } = req.params
      if (!isValidUsername(username) || !UUID_RE.test(postId)) {
        return res.status(404).json({ error: 'Not found', success: false })
      }
      const token = typeof req.query.token === 'string' ? req.query.token : undefined
      try {
        const structured = await resolveStructuredPost(username, postId, token)
        if (!structured) {
          return res.status(404).json({ error: 'Not found', success: false })
        }
        res.setHeader('Cache-Control', 'no-store')
        res.json({ structured, success: true })
      } catch (error) {
        if (isMissingDatabase(error)) {
          return res.status(404).json({ error: 'Not found', success: false })
        }
        throw error
      }
    },
  )

  return router
}
