import { goalHistoryQuerySchema, setTagMappingBodySchema, updateSettingsInputSchema } from '@aurboda/api-spec'
import { z } from 'zod'

import { getActivityTypeNames } from '../db/index.ts'
import { getGoalHistory } from '../services/goal-history.ts'
import { getGoalsProgress } from '../services/goals.ts'
import {
  getSettingsResponse,
  getTagMappings,
  setTagMapping,
  validateAndUpdateSettings,
} from '../services/settings.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerSettingsTools = (server: McpServer, user: string) => {
  server.tool(
    'get_user_settings',
    "Get user settings including birth date, effective HR zones, and timezone (tz). The tz field returns the auto-detected timezone from the user's device — use it as the tz parameter for all other tools that require it.",
    {},
    async () => {
      const result = await getSettingsResponse(user)
      return jsonResponse(result)
    },
  )

  server.tool(
    'update_user_settings',
    'Update user settings. Can set birth date (for age-based HR zones) and/or custom HR zone thresholds.',
    { ...updateSettingsInputSchema.shape },
    async (params) => {
      const result = await validateAndUpdateSettings(user, params)
      return jsonResponse(result)
    },
  )

  server.tool(
    'get_unique_tags',
    'Get all activity type names that have been defined. Returns a list of type identifier strings.',
    {},
    async () => {
      const types = await getActivityTypeNames(user)
      return jsonResponse({ data: types, success: true })
    },
  )

  server.tool(
    'set_tag_mapping',
    'Set a display name for a programmatic tag (UUID, tag_* prefix, etc.).',
    { ...setTagMappingBodySchema.shape },
    async ({ name, tag_key, icon }) => {
      const mapping = await setTagMapping(user, tag_key, name, icon)
      return jsonResponse({ mapping, success: true })
    },
  )

  server.tool('get_tag_mappings', 'Get all current tag mappings (tag key -> display name).', {}, async () => {
    const result = await getTagMappings(user)
    return jsonResponse({ ...result, success: true })
  })

  server.tool(
    'get_goal_progress',
    'Get progress toward all user goals. Returns current value, min/max targets, and how much will be lost when the oldest day exits the rolling window.',
    {},
    async () => {
      const goals = await getGoalsProgress(user)
      return jsonResponse({ goals, success: true })
    },
  )

  server.tool(
    'get_goal_history',
    "Get a goal's value and on-target status (below/met/over) per past day in the user's device timezone (UTC when unset), or with bucket=month the count of on-target days per month. A day's value is the goal's rolling window sum (metric goals), rolling window sum or max (measure goals) or EMA (trend goals) at the end of that day, judged against the goal's current min/max. Today is partial and not counted in the summary or months.",
    { id: z.string().uuid(), ...goalHistoryQuerySchema.shape },
    async ({ id, ...query }) => {
      const result = await getGoalHistory(user, id, query)
      return result ? jsonResponse(result) : errorResponse('Goal not found')
    },
  )
}
