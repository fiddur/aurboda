/**
 * Activities and productivity route group.
 *
 * Handles: /activities/*, /productivity
 */
import {
  type ActivitiesQuery,
  activitiesQuerySchema,
  type ActivitiesResponse,
  type AddActivityBody,
  addActivityBodySchema,
  type AddActivityResponse,
  type DeleteActivityResponse,
  getExerciseTypeValue,
  isValidExerciseType,
  type ProductivityQuery,
  productivityQuerySchema,
  type ProductivityResponse,
  type ScreentimeBucketedQuery,
  screentimeBucketedQuerySchema,
  type ScreentimeBucketedResponse,
  type UpdateActivityBody,
  updateActivityBodySchema,
  type UpdateActivityResponse,
} from '@aurboda/api-spec'
import { type RequestHandler, Router } from 'express'

import {
  getActivityById,
  getDistinctApps,
  getOverlappingActivities,
  getProductivityBucketed,
  getProductivityById,
} from '../db/index.ts'
import {
  addActivity,
  deleteActivity,
  deleteProductivity,
  restoreActivity,
  restoreProductivity,
  updateActivity,
} from '../services/mutations.ts'
import {
  assembleScreentimeBuckets,
  parseBucketSize,
  queryActivities,
  queryProductivity,
  type SyncProvider,
} from '../services/queries.ts'
import { validateBody, validateQuery } from '../validation.ts'

export const createActivitiesRouter = (
  authMiddleware: RequestHandler,
  syncProvider?: SyncProvider,
): Router => {
  const router = Router()

  // GET /activities - Query activities for a time range
  router.get<Record<string, never>, ActivitiesResponse, unknown, ActivitiesQuery>(
    '/activities',
    authMiddleware,
    validateQuery(activitiesQuerySchema),
    async (req, res) => {
      const { start, end, types: typesParam } = req.query
      const user = req.user!

      const types = (typesParam?.split(',') || ['sleep', 'exercise', 'meditation', 'nap']) as (
        | 'sleep'
        | 'exercise'
        | 'meditation'
        | 'nap'
      )[]

      const activities = await queryActivities(user, types, new Date(start), new Date(end), syncProvider)
      res.json({ data: activities, success: true })
    },
  )

  // POST /activities - Add a manual activity

  router.post<Record<string, never>, AddActivityResponse, AddActivityBody>(
    '/activities',
    authMiddleware,
    validateBody(addActivityBodySchema),
    async (req, res) => {
      const { activity_type, start_time, end_time, title, notes, exercise_type } = req.body
      const user = req.user!

      const startDate = new Date(start_time)
      const endDate = new Date(end_time)

      // Validate and convert exercise_type name to value if provided
      let data: Record<string, unknown> | undefined
      if (exercise_type !== undefined) {
        if (!isValidExerciseType(exercise_type)) {
          return res.status(400).json({
            error: `Invalid exercise_type "${exercise_type}"`,
            success: false,
          })
        }
        data = {
          exerciseType: getExerciseTypeValue(exercise_type),
          exerciseTypeName: exercise_type,
        }
      }

      const result = await addActivity(user, {
        activity_type,
        data,
        end_time: endDate,
        notes,
        start_time: startDate,
        title,
      })

      if (!result.success) {
        return res.status(400).json({ error: result.error, success: false })
      }

      res.json({
        data: {
          activity_type: result.activity_type!,
          end_time: result.end_time!,
          id: result.id!,
          notes: result.notes,
          start_time: result.start_time!,
          title: result.title,
        },
        success: true,
      })
    },
  )

  // DELETE /activities/:id - Delete an activity by ID
  router.delete<{ id: string }, DeleteActivityResponse>(
    '/activities/:id',
    authMiddleware,
    async (req, res) => {
      const { id } = req.params
      const user = req.user!

      const result = await deleteActivity(user, id)

      if (!result.success) {
        return res.status(404).json({ error: 'Activity not found', success: false })
      }

      res.json({ success: true })
    },
  )

  // PATCH /activities/:id - Update an activity by ID
  router.patch<{ id: string }, UpdateActivityResponse, UpdateActivityBody>(
    '/activities/:id',
    authMiddleware,
    validateBody(updateActivityBodySchema),
    async (req, res) => {
      const { id } = req.params
      const { start_time, end_time, title, notes, exercise_type } = req.body
      const user = req.user!

      // Convert exercise_type name to data object if provided
      let data: Record<string, unknown> | undefined
      if (exercise_type !== undefined) {
        if (!isValidExerciseType(exercise_type)) {
          return res.status(400).json({
            error: `Invalid exercise_type "${exercise_type}"`,
            success: false,
          })
        }
        data = {
          exerciseType: getExerciseTypeValue(exercise_type),
          exerciseTypeName: exercise_type,
        }
      }

      const result = await updateActivity(user, id, {
        data,
        end_time: end_time ? new Date(end_time) : undefined,
        notes,
        start_time: start_time ? new Date(start_time) : undefined,
        title,
      })

      if (!result.success) {
        const status = result.error === 'Activity not found' ? 404 : 400
        return res.status(status).json({ error: result.error, success: false })
      }

      res.json({
        data: {
          activity_type: result.activity_type!,
          end_time: result.end_time!,
          id: result.id!,
          notes: result.notes,
          start_time: result.start_time!,
          title: result.title,
        },
        success: true,
      })
    },
  )

  // GET /activities/:id - Get a single activity by ID (for detail page)
  // Supports merged: prefix — merged:<uuid> returns merged view, plain uuid returns raw activity
  router.get<{ id: string }>('/activities/:id', authMiddleware, async (req, res) => {
    const rawId = req.params.id
    const user = req.user!

    const isMerged = rawId.startsWith('merged:')
    const realId = isMerged ? rawId.slice('merged:'.length) : rawId

    const activity = await getActivityById(user, realId, true)
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found', success: false })
    }

    // For merged: prefix, fetch overlapping activities and return merged view
    if (isMerged && !activity.deleted_at) {
      const overlapping = await getOverlappingActivities(user, activity)
      const hasMultipleSources = overlapping.length > 1

      const sourceRecords = hasMultipleSources
        ? overlapping.map((a) => {
            const data = a.data as Record<string, unknown> | undefined
            return {
              data_origin: data?.dataOrigin as string | undefined,
              end_time: a.end_time?.toISOString(),
              exercise_type_name: data?.exerciseTypeName as string | undefined,
              id: a.id!,
              source: a.source,
              start_time: a.start_time.toISOString(),
              title: a.title,
            }
          })
        : undefined

      const mergedStartTime = hasMultipleSources
        ? new Date(Math.min(...overlapping.map((a) => a.start_time.getTime()))).toISOString()
        : undefined
      const mergedEndTime = hasMultipleSources
        ? new Date(Math.max(...overlapping.map((a) => (a.end_time ?? a.start_time).getTime()))).toISOString()
        : undefined

      // Compute merged fields from all sources (same rules as mergeOverlappingActivities)
      const sorted = [...overlapping].sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
      const mergedTitle = sorted.find((a) => a.title)?.title ?? activity.title
      const mergedNotes =
        sorted
          .map((a) => a.notes)
          .filter(Boolean)
          .join('\n') || activity.notes
      const mergedData = sorted.reduce<Record<string, unknown>>(
        (acc, a) => (a.data ? { ...acc, ...a.data } : acc),
        {},
      )

      return res.json({
        data: {
          activity_type: activity.activity_type,
          data: Object.keys(mergedData).length > 0 ? mergedData : activity.data,
          end_time: activity.end_time?.toISOString(),
          id: activity.id,
          merged_end_time: mergedEndTime,
          merged_start_time: mergedStartTime,
          notes: mergedNotes,
          source: activity.source,
          source_records: sourceRecords,
          start_time: activity.start_time.toISOString(),
          title: mergedTitle,
        },
        success: true,
      })
    }

    // Plain UUID: return raw single activity (no overlap lookup)
    res.json({
      data: {
        activity_type: activity.activity_type,
        data: activity.data,
        deleted_at: activity.deleted_at?.toISOString(),
        end_time: activity.end_time?.toISOString(),
        id: activity.id,
        notes: activity.notes,
        source: activity.source,
        start_time: activity.start_time.toISOString(),
        title: activity.title,
      },
      success: true,
    })
  })

  // POST /activities/:id/restore - Restore a soft-deleted activity
  router.post<{ id: string }>('/activities/:id/restore', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    const result = await restoreActivity(user, id)
    if (!result.success) {
      return res.status(404).json({ error: 'Activity not found or not deleted', success: false })
    }

    res.json({ success: true })
  })

  // GET /productivity/bucketed - Get screentime bucketed by time and category
  router.get<Record<string, never>, ScreentimeBucketedResponse, unknown, ScreentimeBucketedQuery>(
    '/productivity/bucketed',
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

  // GET /productivity/apps - Get distinct app names with their categories
  router.get('/productivity/apps', authMiddleware, async (req, res) => {
    const user = req.user!
    const apps = await getDistinctApps(user)
    res.json({ data: apps, success: true })
  })

  // GET /productivity/:id - Get a single productivity record by ID
  router.get<{ id: string }>('/productivity/:id', authMiddleware, async (req, res) => {
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

  // DELETE /productivity/:id - Soft-delete a productivity record
  router.delete<{ id: string }>('/productivity/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    const result = await deleteProductivity(user, id)
    if (!result.success) {
      return res.status(404).json({ error: 'Productivity record not found', success: false })
    }

    res.json({ success: true })
  })

  // POST /productivity/:id/restore - Restore a soft-deleted productivity record
  router.post<{ id: string }>('/productivity/:id/restore', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    const result = await restoreProductivity(user, id)
    if (!result.success) {
      return res.status(404).json({ error: 'Record not found or not deleted', success: false })
    }

    res.json({ success: true })
  })

  // GET /productivity - Query productivity data for a time range
  router.get<Record<string, never>, ProductivityResponse, unknown, ProductivityQuery>(
    '/productivity',
    authMiddleware,
    validateQuery(productivityQuerySchema),
    async (req, res) => {
      const { start, end } = req.query
      const user = req.user!

      const productivity = await queryProductivity(user, new Date(start), new Date(end), syncProvider)
      res.json({ data: productivity, success: true })
    },
  )

  return router
}
