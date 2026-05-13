/**
 * MCP activity management tools.
 */
import {
  addActivityBodySchema,
  deleteActivityParamsSchema,
  tzSchema,
  updateActivityBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import type { ActivityNotifier } from '../services/deduction-queue.ts'

import {
  addActivity,
  deleteActivity,
  mergeActivities,
  restoreActivity,
  updateActivity,
} from '../services/mutations.ts'
import { errorResponse, jsonResponse, type McpServer, tzJsonResponse } from './helpers.ts'

export const registerActivityTools = (
  server: McpServer,
  user: string,
  onActivityMutated?: ActivityNotifier,
) => {
  // Tool: add_activity
  server.tool(
    'add_activity',
    'Add an activity session (exercise type like yoga/running/weightlifting, meditation, nap, rest, …). Pass the specific activity_type directly; structured fields go in `data`.',
    {
      ...addActivityBodySchema.shape,
      tz: tzSchema,
    },
    async ({ activity_type, data, end_time, notes, start_time, title, tz }) => {
      const startDate = new Date(start_time)
      const endDate = end_time ? new Date(end_time) : undefined

      const result = await addActivity(
        user,
        {
          activity_type,
          data,
          end_time: endDate,
          notes,
          start_time: startDate,
          title,
        },
        onActivityMutated,
      )

      if (!result.success) {
        return errorResponse(result.error ?? 'Failed to add activity')
      }

      return tzJsonResponse(result, tz)
    },
  )

  // Tool: delete_activity
  server.tool(
    'delete_activity',
    'Delete an activity by its ID. Returns success if the activity was found and deleted.',
    { ...deleteActivityParamsSchema.shape },
    async ({ id }) => {
      const result = await deleteActivity(user, id)
      return jsonResponse(result)
    },
  )

  // Tool: restore_activity
  server.tool(
    'restore_activity',
    'Restore a soft-deleted activity by its ID.',
    { id: z.string().uuid().describe('The ID of the activity to restore') },
    async ({ id }) => {
      const result = await restoreActivity(user, id)
      return jsonResponse(result)
    },
  )

  // Tool: update_activity
  server.tool(
    'update_activity',
    'Update an existing activity. Can modify activity_type, start_time, end_time, title, notes, and data. Only provided fields will be updated. Validates that end_time is after start_time (considering both new and existing values).',
    {
      id: z.string().uuid().describe('The ID of the activity to update'),
      ...updateActivityBodySchema.shape,
      tz: tzSchema,
    },
    async ({ id, activity_type, data, start_time, end_time, title, notes, tz }) => {
      const result = await updateActivity(
        user,
        id,
        {
          activity_type,
          data,
          end_time: end_time ? new Date(end_time) : undefined,
          notes,
          start_time: start_time ? new Date(start_time) : undefined,
          title,
        },
        onActivityMutated,
      )

      if (!result.success) {
        return errorResponse(result.error ?? 'Failed to update activity')
      }

      return tzJsonResponse(result, tz)
    },
  )

  // Tool: merge_activities
  server.tool(
    'merge_activities',
    'Permanently merge 2+ activities of the same type into one. Creates a new merged activity spanning the full time range and soft-deletes the originals. Useful for fixing split activities (e.g., a run that got recorded as two separate activities).',
    {
      activity_ids: z.array(z.string().uuid()).min(2).describe('IDs of activities to merge (minimum 2)'),
      notes: z.string().optional().describe('Optional notes override for the merged activity'),
      title: z.string().optional().describe('Optional title override for the merged activity'),
      tz: tzSchema,
    },
    async ({ activity_ids, notes, title, tz }) => {
      const result = await mergeActivities(user, { activity_ids, notes, title }, undefined, onActivityMutated)

      if (!result.success) {
        return errorResponse(result.error ?? 'Failed to merge activities')
      }

      return tzJsonResponse(result, tz)
    },
  )
}
