/**
 * MCP user settings and tag mapping tools.
 */
import { setTagMappingBodySchema, tzSchema, updateSettingsInputSchema } from '@aurboda/api-spec'

import { getActivityTypeNames, getUserSettings } from '../db/index.ts'
import { getGoalsProgress } from '../services/goals.ts'
import {
  getSettingsResponse,
  getTagMappings,
  setTagMapping,
  validateAndUpdateSettings,
} from '../services/settings.ts'
import { jsonResponse, type McpServer, tzJsonResponse } from './helpers.ts'
import { formatInTz } from './tz-utils.ts'

export const registerSettingsTools = (server: McpServer, user: string) => {
  // Tool: get_user_settings
  server.tool(
    'get_user_settings',
    "Get user settings including birth date, effective HR zones, and timezone (tz). The tz field returns the auto-detected timezone from the user's device — use it as the tz parameter for all other tools that require it.",
    {},
    async () => {
      const result = await getSettingsResponse(user)
      return jsonResponse(result)
    },
  )

  // Tool: update_user_settings
  server.tool(
    'update_user_settings',
    'Update user settings. Can set birth date (for age-based HR zones) and/or custom HR zone thresholds.',
    { ...updateSettingsInputSchema.shape },
    async (params) => {
      const result = await validateAndUpdateSettings(user, params)
      return jsonResponse(result)
    },
  )

  // Tool: get_unique_tags
  server.tool(
    'get_unique_tags',
    'Get all activity type names that have been defined. Returns a list of type identifier strings.',
    {},
    async () => {
      const types = await getActivityTypeNames(user)
      return jsonResponse({ data: types, success: true })
    },
  )

  // Tool: set_tag_mapping
  server.tool(
    'set_tag_mapping',
    'Set a display name for a programmatic tag (UUID, tag_* prefix, etc.). Use after get_programmatic_tags to name unmapped tags.',
    { ...setTagMappingBodySchema.shape },
    async ({ name, tag_key, icon }) => {
      const mapping = await setTagMapping(user, tag_key, name, icon)
      return jsonResponse({ mapping, success: true })
    },
  )

  // Tool: get_tag_mappings
  server.tool('get_tag_mappings', 'Get all current tag mappings (tag key -> display name).', {}, async () => {
    const result = await getTagMappings(user)
    return jsonResponse({ ...result, success: true })
  })

  // Tool: get_goal_progress
  server.tool(
    'get_goal_progress',
    'Get progress toward all user goals. Returns current value, min/max targets, and how much will be lost when the oldest day exits the rolling window.',
    {},
    async () => {
      const goals = await getGoalsProgress(user)
      return jsonResponse({ goals, success: true })
    },
  )
}
