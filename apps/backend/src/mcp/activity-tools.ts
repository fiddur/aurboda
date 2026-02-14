/**
 * MCP activity management tools.
 */
import {
  activityTypes,
  activityTypeSchema,
  endDateTimeQuerySchema,
  exerciseTypeNames,
  getExerciseTypeValue,
  isValidExerciseType,
  startDateTimeQuerySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'
import { addActivity, deleteActivity, updateActivity } from '../services/mutations'
import { errorResponse, jsonResponse, type McpServer } from './helpers'

// eslint-disable-next-line max-lines-per-function -- tool registrations are inherently long
export const registerActivityTools = (server: McpServer, user: string) => {
  // Tool: add_activity
  server.tool(
    'add_activity',
    'Add an activity session (exercise, meditation, nap). Use this to log workouts or other activities.',
    {
      activity_type: activityTypeSchema.describe(
        `Type of activity. Valid types: ${activityTypes.join(', ')}`,
      ),
      end_time: endDateTimeQuerySchema.describe('End time in ISO 8601 format (e.g., 2024-03-15T11:45:00Z)'),
      exercise_type: z
        .string()
        .optional()
        .describe(
          `Exercise type name (e.g., "weightlifting", "running"). Only for exercise activities. Valid types: ${exerciseTypeNames.slice(0, 10).join(', ')}...`,
        ),
      notes: z
        .string()
        .optional()
        .describe(
          'Activity notes. For workouts, use format: "Exercise Name: reps×weight, reps×weight" per line.',
        ),
      start_time: startDateTimeQuerySchema.describe(
        'Start time in ISO 8601 format (e.g., 2024-03-15T10:30:00Z)',
      ),
      title: z.string().optional().describe('Activity title (e.g., "Upper body", "Morning meditation")'),
    },
    async ({ activity_type, end_time, exercise_type, notes, start_time, title }) => {
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

      return jsonResponse(result)
    },
  )

  // Tool: delete_activity
  server.tool(
    'delete_activity',
    'Delete an activity by its ID. Returns success if the activity was found and deleted.',
    {
      id: z.string().uuid().describe('The ID of the activity to delete'),
    },
    async ({ id }) => {
      const result = await deleteActivity(user, id)
      return jsonResponse(result)
    },
  )

  // Tool: update_activity
  server.tool(
    'update_activity',
    'Update an existing activity. Can modify start_time, end_time, title, and notes. Only provided fields will be updated. Validates that end_time is after start_time (considering both new and existing values).',
    {
      end_time: endDateTimeQuerySchema.optional().describe('New end time in ISO 8601 format'),
      id: z.string().uuid().describe('The ID of the activity to update'),
      notes: z.string().optional().describe('New activity notes'),
      start_time: startDateTimeQuerySchema.optional().describe('New start time in ISO 8601 format'),
      title: z.string().optional().describe('New activity title'),
    },
    async ({ id, start_time, end_time, title, notes }) => {
      const result = await updateActivity(user, id, {
        end_time: end_time ? new Date(end_time) : undefined,
        notes,
        start_time: start_time ? new Date(start_time) : undefined,
        title,
      })

      if (!result.success) {
        return errorResponse(result.error ?? 'Failed to update activity')
      }

      return jsonResponse(result)
    },
  )
}
