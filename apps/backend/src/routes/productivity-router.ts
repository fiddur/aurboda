/**
 * Productivity (RescueTime / ActivityWatch screentime) route group.
 *
 * Handles: /productivity, /productivity/bucketed, /productivity/apps,
 *          /productivity/:id, /productivity/:id/restore.
 *
 * Productivity records are conceptually screentime spans rather than activities,
 * so they live in their own router (extracted from activities-router.ts).
 */
import {
  type DistinctAppsResponse,
  type ProductivityQuery,
  productivityQuerySchema,
  type ProductivityRecordResponse,
  type ProductivityResponse,
  type ScreentimeBucketedQuery,
  screentimeBucketedQuerySchema,
  type ScreentimeBucketedResponse,
} from '@aurboda/api-spec'

import { getDistinctApps, getProductivityBucketed, getProductivityById } from '../db/index.ts'
import { deleteProductivity, restoreProductivity } from '../services/mutations.ts'
import {
  assembleScreentimeBuckets,
  parseBucketSize,
  queryProductivity,
  type SyncProvider,
} from '../services/queries/index.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createProductivityRouter = (
  authMiddleware: AnyMiddleware,
  syncProvider?: SyncProvider,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, ScreentimeBucketedResponse, unknown, ScreentimeBucketedQuery>(
    '/bucketed',
    authMiddleware,
    validateQuery(screentimeBucketedQuerySchema),
    async (req, res) => {
      const user = req.user!
      const { start, end, bucket, tz } = req.query
      const { interval, ms: bucketMs } = parseBucketSize(bucket)

      const rows = await getProductivityBucketed(user, new Date(start), new Date(end), interval, tz ?? 'UTC')
      const buckets = assembleScreentimeBuckets(rows, bucketMs)

      res.json({
        bucket: req.query.bucket,
        buckets,
        end,
        start,
        success: true,
      })
    },
  )

  router.get<Record<string, never>, DistinctAppsResponse>('/apps', authMiddleware, async (req, res) => {
    const user = req.user!
    const apps = await getDistinctApps(user)
    res.json({
      data: apps.map((a) => ({ ...a, last_seen: a.last_seen.toISOString() })),
      success: true,
    })
  })

  router.get<{ id: string }, ProductivityRecordResponse>('/:id', authMiddleware, async (req, res) => {
    const user = req.user!
    const record = await getProductivityById(user, req.params.id)
    if (!record) {
      return res.status(404).json({ error: 'Productivity record not found', success: false })
    }
    res.json({
      data: {
        activity: record.activity,
        category: record.category,
        device_name: record.device_name,
        duration_sec: record.duration_sec,
        end_time: record.end_time.toISOString(),
        id: record.id,
        is_mobile: record.is_mobile,
        productivity: record.productivity,
        resolved_category: record.resolved_category,
        source: record.source,
        start_time: record.start_time.toISOString(),
        title: record.title,
      },
      success: true,
    })
  })

  router.delete<{ id: string }, { success: boolean; error?: string }>(
    '/:id',
    authMiddleware,
    async (req, res) => {
      const { id } = req.params
      const user = req.user!

      const result = await deleteProductivity(user, id)
      if (!result.success) {
        return res.status(404).json({ error: 'Productivity record not found', success: false })
      }

      res.json({ success: true })
    },
  )

  router.post<{ id: string }, { success: boolean; error?: string }>(
    '/:id/restore',
    authMiddleware,
    async (req, res) => {
      const { id } = req.params
      const user = req.user!

      const result = await restoreProductivity(user, id)
      if (!result.success) {
        return res.status(404).json({ error: 'Record not found or not deleted', success: false })
      }

      res.json({ success: true })
    },
  )

  router.get<Record<string, never>, ProductivityResponse, unknown, ProductivityQuery>(
    '/',
    authMiddleware,
    validateQuery(productivityQuerySchema),
    async (req, res) => {
      const { start, end, merge_by, merge_gap_ms } = req.query
      const user = req.user!

      const gapMs = merge_gap_ms ? parseInt(merge_gap_ms, 10) : undefined
      const result = await queryProductivity(
        user,
        new Date(start),
        new Date(end),
        syncProvider,
        merge_by,
        gapMs,
      )
      res.json({ categories: result.categories, data: result.data, success: true })
    },
  )

  return router
}
