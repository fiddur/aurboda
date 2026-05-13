import type { RequestHandler } from 'express'

/**
 * Metrics route group.
 *
 * Handles: /metrics/*, /daily-summary, /period-summary
 */
import {
  type AddCustomMetricBody,
  addCustomMetricBodySchema,
  type AddMetricBody,
  addMetricBodySchema,
  type AddMetricResponse,
  type BulkMetricsBody,
  bulkMetricsBodySchema,
  type BulkMetricsResponse,
  type CustomMetricResponse,
  type CustomMetricsListResponse,
  type DailySummaryQuery,
  dailySummaryQuerySchema,
  type DailySummaryResponse,
  type DeleteMetricQuery,
  deleteMetricQuerySchema,
  type DeleteMetricResponse,
  type LatestMetricResponse,
  type MergeCustomMetricBody,
  mergeCustomMetricBodySchema,
  type MergeCustomMetricResponse,
  type PeriodSummaryQuery,
  periodSummaryQuerySchema,
  type PeriodSummaryResponse,
  type QueryMetricsBucketedQuery,
  queryMetricsBucketedQuerySchema,
  type QueryMetricsBucketedResponse,
  type QueryMetricsQuery,
  queryMetricsQuerySchema,
  type QueryMetricsResponse,
  type RecalculateCaloriesBody,
  type RecalculateCaloriesResponse,
  type UpdateCustomMetricBody,
  updateCustomMetricBodySchema,
} from '@aurboda/api-spec'

import type { MetricType } from '../schema.ts'

import { auditError, auditInfo } from '../services/audit-log.ts'
import { computeAndStoreCalories, computeAndStoreCaloriesAll } from '../services/calorie-computation.ts'
import { mergeCustomMetricService } from '../services/custom-metrics.ts'
import {
  addCustomMetric,
  addMetric,
  bulkAddMetrics,
  deleteCustomMetric,
  deleteMetric,
  deleteMetricData,
  getCustomMetrics,
  updateCustomMetric,
} from '../services/mutations.ts'
import {
  getDailySummary,
  getPeriodSummary,
  queryMetrics,
  queryMetricsBucketed,
  type SyncProvider,
} from '../services/queries/index.ts'
import { getLatestMetric } from '../services/reports.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

export const createMetricsRouter = (
  authMiddleware: RequestHandler,
  syncProvider?: SyncProvider,
): TypedRouter => {
  const router = typedRouter()

  // Must come before /metrics/:metric to avoid parameter capture
  router.get<Record<string, never>, QueryMetricsBucketedResponse, unknown, QueryMetricsBucketedQuery>(
    '/metrics/bucketed',
    authMiddleware,
    validateQuery(queryMetricsBucketedQuerySchema),
    async (req, res) => {
      const { start, end, bucket, metrics: metricsParam, exclude: excludeParam, tz } = req.query
      const user = req.user!

      const customMetrics = await getCustomMetrics(user)

      // Parse optional metrics and exclude lists
      const metrics = metricsParam ? metricsParam.split(',') : undefined
      const exclude = excludeParam ? excludeParam.split(',') : undefined

      const result = await queryMetricsBucketed(
        user,
        metrics as MetricType[] | undefined,
        new Date(start),
        new Date(end),
        bucket,
        { customMetrics, exclude, tz },
      )
      res.json({ ...result, success: true })
    },
  )

  router.get<Record<string, never>, CustomMetricsListResponse>(
    '/metrics/custom',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const metrics = await getCustomMetrics(user)
      res.json({ data: metrics, success: true })
    },
  )

  router.post<Record<string, never>, CustomMetricResponse, AddCustomMetricBody>(
    '/metrics/custom',
    authMiddleware,
    validateBody(addCustomMetricBodySchema),
    async (req, res) => {
      const user = req.user!
      const result = await addCustomMetric(user, req.body)
      if (!result.success) {
        return res.status(400).json({ error: result.error, success: false })
      }
      res.json({ data: result.data, success: true })
    },
  )

  router.delete<{ name: string }, CustomMetricResponse>(
    '/metrics/custom/:name',
    authMiddleware,
    async (req, res) => {
      const { name } = req.params
      const user = req.user!
      const result = await deleteCustomMetric(user, name)
      if (!result.deleted) {
        return res.status(404).json({ error: `Custom metric "${name}" not found`, success: false })
      }
      res.json({ success: true })
    },
  )

  router.post<Record<string, never>, MergeCustomMetricResponse, MergeCustomMetricBody>(
    '/metrics/custom/merge',
    authMiddleware,
    validateBody(mergeCustomMetricBodySchema),
    async (req, res) => {
      const { source, target } = req.body
      const user = req.user!
      const result = await mergeCustomMetricService(user, source, target)
      if (!result.success) {
        return res.status(400).json({ error: result.error, success: false })
      }
      res.json(result)
    },
  )

  router.patch<{ name: string }, CustomMetricResponse, UpdateCustomMetricBody>(
    '/metrics/custom/:name',
    authMiddleware,
    validateBody(updateCustomMetricBodySchema),
    async (req, res) => {
      const { name } = req.params
      const user = req.user!
      const result = await updateCustomMetric(user, name, req.body)
      if (!result.success) {
        return res.status(404).json({ error: result.error, success: false })
      }
      res.json({ data: result.data, success: true })
    },
  )

  // With start/end: synchronous range recompute. Without: async full recompute.
  router.post<Record<string, never>, RecalculateCaloriesResponse, Partial<RecalculateCaloriesBody>>(
    '/metrics/recalculate-calories',
    authMiddleware,
    async (req, res) => {
      const { start, end } = req.body
      const user = req.user!

      if (!start || !end) {
        // Full recompute runs async — fire and forget
        computeAndStoreCaloriesAll(user).then(
          (result) =>
            auditInfo(user, 'data', `Async calorie recompute done: ${result.points_stored} points`, {
              days: result.days_processed,
            }),
          (error) => auditError(user, 'data', 'Async calorie recompute failed', { error: String(error) }),
        )
        return res.json({
          points_computed: 0,
          points_stored: 0,
          skipped_reason: 'full recomputation started in background',
          success: true,
        })
      }

      const result = await computeAndStoreCalories(user, new Date(start), new Date(end), { force: true })
      res.json({ ...result, success: true })
    },
  )

  router.post<Record<string, never>, BulkMetricsResponse, BulkMetricsBody>(
    '/metrics/bulk',
    authMiddleware,
    validateBody(bulkMetricsBodySchema),
    async (req, res) => {
      const { data, source } = req.body
      const user = req.user!

      const items = data.map((item) => ({
        metric: item.metric,
        source: item.source,
        time: new Date(item.time),
        value: item.value,
      }))

      const result = await bulkAddMetrics(user, items, source)
      res.json(result)
    },
  )

  router.get<{ metric: string }, LatestMetricResponse>(
    '/metrics/latest/:metric',
    authMiddleware,
    async (req, res) => {
      const { metric } = req.params
      const user = req.user!

      const result = await getLatestMetric(user, metric)

      if (!result.success) {
        return res.status(404).json({ error: result.error, success: false })
      }

      res.json({ ...result, success: true })
    },
  )

  router.delete<{ metric: string }, { success: boolean; deleted?: number }>(
    '/metrics/:metric/data',
    authMiddleware,
    async (req, res) => {
      const { metric } = req.params
      const user = req.user!
      const result = await deleteMetricData(user, metric)
      res.json({ ...result, success: true })
    },
  )

  router.delete<{ metric: string }, DeleteMetricResponse, unknown, DeleteMetricQuery>(
    '/metrics/:metric',
    authMiddleware,
    validateQuery(deleteMetricQuerySchema),
    async (req, res) => {
      const { metric } = req.params
      const { time, source } = req.query
      const user = req.user!
      const result = await deleteMetric(user, metric, new Date(time), source)
      if (!result.deleted) {
        return res.status(404).json({ deleted: false, error: 'Measurement not found', success: false })
      }
      res.json({ ...result, success: true })
    },
  )

  router.get<{ metric: string }, QueryMetricsResponse, unknown, QueryMetricsQuery>(
    '/metrics/:metric',
    authMiddleware,
    validateQuery(queryMetricsQuerySchema),
    async (req, res) => {
      const { metric } = req.params
      const { start, end } = req.query
      const user = req.user!

      const customMetrics = await getCustomMetrics(user)

      const result = await queryMetrics(user, metric, new Date(start), new Date(end), customMetrics)
      res.json({ ...result, success: true })
    },
  )

  router.post<Record<string, never>, AddMetricResponse, AddMetricBody>(
    '/metrics',
    authMiddleware,
    validateBody(addMetricBodySchema),
    async (req, res) => {
      const { metric, value, time } = req.body
      const user = req.user!

      const measurementTime = time ? new Date(time) : new Date()

      const result = await addMetric(user, { metric, time: measurementTime, value })
      res.json(result)
    },
  )

  router.get<Record<string, never>, DailySummaryResponse, unknown, DailySummaryQuery>(
    '/daily-summary',
    authMiddleware,
    validateQuery(dailySummaryQuerySchema),
    async (req, res) => {
      const { date } = req.query
      const user = req.user!

      const summary = await getDailySummary(user, new Date(date), syncProvider)
      res.json({ data: summary, success: true })
    },
  )

  router.get<Record<string, never>, PeriodSummaryResponse, unknown, PeriodSummaryQuery>(
    '/period-summary',
    authMiddleware,
    validateQuery(periodSummaryQuerySchema),
    async (req, res) => {
      const { start, end, metrics: metricsParam } = req.query
      const user = req.user!

      const metrics = metricsParam.split(',')

      const summary = await getPeriodSummary(user, metrics, new Date(start), new Date(end))
      res.json({ ...summary, success: true })
    },
  )

  return router
}
