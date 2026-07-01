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
import { type PublicSeriesQuery, publicSeriesQuerySchema, type PublicSeriesResponse } from '@aurboda/api-spec'

import { isValidUsername } from '../api/auth-routes.ts'
import { findCoveringSharedSeriesWindow, isMissingDatabase } from '../db/index.ts'
import { resolvePublicSeries } from '../services/feed-series.ts'
import { queryMetricsBucketed } from '../services/queries/index.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

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
        res.setHeader('Cache-Control', 'public, max-age=60')
        res.json({ ...result, success: true })
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
