import type { RequestHandler } from 'express'

import {
  type ChartDataHttpQuery,
  chartDataHttpQuerySchema,
  type ChartDataResponse,
  chartBreakdownError,
  chartFilterError,
  type ChartFirstDayQuery,
  chartFirstDayQuerySchema,
  type ChartFirstDayResponse,
  journalChartError,
  journalChartFiltersOf,
} from '@aurboda/api-spec'

import { getChartData } from '../services/chart-data.ts'
import { getChartFirstDay } from '../services/chart-first-day.ts'
import { getUserTimezone } from '../services/settings.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createChartDataRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, ChartDataResponse, unknown, ChartDataHttpQuery>(
    '/',
    authMiddleware,
    validateQuery(chartDataHttpQuerySchema),
    async (req, res) => {
      const {
        aggregation,
        breakdown_fields: breakdownFieldsStr,
        bucket_size,
        end,
        filter_field,
        filter_value,
        measure,
        pattern,
        source_type,
        start,
        tag_definition_id,
        tz,
      } = req.query
      const breakdown_fields = breakdownFieldsStr
        ? breakdownFieldsStr
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined
      const user = req.user!

      if (source_type !== 'journal' && !pattern && !tag_definition_id) {
        return res
          .status(400)
          .json({ error: 'Either pattern or tag_definition_id is required', success: false })
      }
      const queryError =
        journalChartError({ ...req.query, breakdown_fields }) ??
        chartBreakdownError(breakdown_fields, measure) ??
        chartFilterError(filter_field, filter_value, breakdown_fields, measure)
      if (queryError) return res.status(400).json({ error: queryError, success: false })

      const result = await getChartData(user, {
        aggregation: aggregation ?? 'count',
        breakdown_fields,
        bucket_size: bucket_size ?? '1d',
        end,
        filter_field,
        filter_value,
        measure,
        pattern,
        source_type,
        start,
        tag_definition_id,
        tz,
        ...journalChartFiltersOf(req.query),
      })
      res.json({
        data: {
          breakdown_fields: result.breakdown_fields,
          breakdown_series: result.breakdown_series,
          buckets: result.buckets,
        },
        success: true,
      })
    },
  )

  router.get<Record<string, never>, ChartFirstDayResponse, unknown, ChartFirstDayQuery>(
    '/first-day',
    authMiddleware,
    validateQuery(chartFirstDayQuerySchema),
    async (req, res) => {
      const user = req.user!
      const first_day = await getChartFirstDay(user, {
        ...req.query,
        tz: req.query.tz ?? (await getUserTimezone(user)),
      })
      res.json({ data: first_day === undefined ? {} : { first_day }, success: true })
    },
  )

  return router
}
