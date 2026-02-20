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
  type UpdateActivityBody,
  updateActivityBodySchema,
  type UpdateActivityResponse,
} from '@aurboda/api-spec'
import { RequestHandler, Router } from 'express'
import { getActivityById } from '../db'
import {
  addActivity,
  deleteActivity,
  deleteProductivity,
  restoreActivity,
  restoreProductivity,
  updateActivity,
} from '../services/mutations'
import { queryActivities, queryProductivity, type SyncProvider } from '../services/queries'
import { validateBody, validateQuery } from '../validation'

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

      const types = (typesParam?.split(',') || ['sleep', 'exercise', 'meditation']) as (
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
      const { start_time, end_time, title, notes } = req.body
      const user = req.user!

      const result = await updateActivity(user, id, {
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
  router.get<{ id: string }>('/activities/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    const activity = await getActivityById(user, id, true)
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found', success: false })
    }

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
