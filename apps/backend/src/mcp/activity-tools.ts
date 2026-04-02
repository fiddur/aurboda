/**
 * MCP activity management tools.
 */
import {
  addActivityBodySchema,
  deleteActivityParamsSchema,
  exerciseTypeNames,
  getExerciseTypeValue,
  isValidExerciseType,
  tzSchema,
  updateActivityBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import {
  addActivity,
  deleteActivity,
  mergeActivities,
  restoreActivity,
  updateActivity,
} from '../services/mutations.ts'
import { errorResponse, jsonResponse, type McpServer, tzJsonResponse } from './helpers.ts'

export const registerActivityTools = (server: McpServer, user: string) => {
  // Tool: add_activity
  server.tool(
    'add_activity',
    'Add an activity session (exercise, meditation, nap, rest). Use this to log workouts or other activities.',
    {
      ...addActivityBodySchema.shape,
      // Override enum with z.string() to allow handler-level validation with friendlier error message
      exercise_type: z
        .string()
        .optional()
        .describe(
          `Exercise type name (e.g., "weightlifting", "running"). Only for exercise activities. Valid types: ${exerciseTypeNames.slice(0, 10).join(', ')}...`,
        ),
      tz: tzSchema,
    },
    async ({ activity_type, end_time, exercise_type, notes, start_time, title, tz }) => {
      const startDate = new Date(start_time)
      const endDate = new Date(end_time)

      let data: Record<string, unknown> | undefined
      if (exercise_type !== undefined) {
        if (!isValidExerciseType(exercise_type)) {
          return errorResponse(
            `Invalid exercise_type "${exercise_type}". Valid types include: ${exerciseTypeNames.slice(0, 15).join(', ')}...`,
          )
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
    'Update an existing activity. Can modify start_time, end_time, title, notes, and exercise_type. Only provided fields will be updated. Validates that end_time is after start_time (considering both new and existing values).',
    {
      id: z.string().uuid().describe('The ID of the activity to update'),
      ...updateActivityBodySchema.shape,
      // Override enum with z.string() to allow handler-level validation with friendlier error message
      exercise_type: z
        .string()
        .optional()
        .describe(
          `New exercise type name (e.g., "weightlifting", "running"). Only for exercise activities. Valid types: ${exerciseTypeNames.slice(0, 10).join(', ')}...`,
        ),
      tz: tzSchema,
    },
    async ({ id, start_time, end_time, title, notes, exercise_type, tz }) => {
      let data: Record<string, unknown> | undefined
      if (exercise_type !== undefined) {
        if (!isValidExerciseType(exercise_type)) {
          return errorResponse(
            `Invalid exercise_type "${exercise_type}". Valid types include: ${exerciseTypeNames.slice(0, 15).join(', ')}...`,
          )
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
      const result = await mergeActivities(user, { activity_ids, notes, title })

      if (!result.success) {
        return errorResponse(result.error ?? 'Failed to merge activities')
      }

      return tzJsonResponse(result, tz)
    },
  )
}
