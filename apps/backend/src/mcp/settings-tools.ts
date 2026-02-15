/**
 * MCP user settings and tag mapping tools.
 */
import { hrZoneThresholdsSchema } from '@aurboda/api-spec'
import { z } from 'zod'
import { getProgrammaticTags, getUniqueTags, getUserSettings, upsertUserSettings } from '../db'
import { getGoalsProgress } from '../services/goals'
import { getSettingsResponse, validateAndUpdateSettings } from '../services/settings'
import { jsonResponse, type McpServer } from './helpers'

// eslint-disable-next-line max-lines-per-function -- tool registrations are inherently long
export const registerSettingsTools = (server: McpServer, user: string) => {
  // Tool: get_user_settings
  server.tool(
    'get_user_settings',
    'Get user settings including birth date and effective HR zones. HR zones are used to calculate time spent in different heart rate zones during exercise.',
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
    {
      birth_date: z
        .string()
        .nullable()
        .optional()
        .describe('Birth date in YYYY-MM-DD format. Set to null to clear.'),
      hr_zone_start: hrZoneThresholdsSchema
        .nullable()
        .optional()
        .describe('Custom HR zone start thresholds. Values must be ascending. Set to null to clear.'),
    },
    async ({ birth_date, hr_zone_start }) => {
      const result = await validateAndUpdateSettings(user, {
        birth_date,
        hr_zone_start,
      })
      return jsonResponse(result)
    },
  )

  // Tool: get_unique_tags
  server.tool(
    'get_unique_tags',
    'Get all unique tag names that have been recorded. Returns a list of tag strings.',
    {},
    async () => {
      const tags = await getUniqueTags(user)
      return jsonResponse({ data: tags, success: true })
    },
  )

  // Tool: get_programmatic_tags
  server.tool(
    'get_programmatic_tags',
    'Get all programmatic tags (UUIDs, tag_* prefixes) with their current mapped names. These are tags that look like they need human-readable display names. Tags without a currentName are unmapped.',
    {},
    async () => {
      const tags = await getProgrammaticTags(user)
      const settings = await getUserSettings(user)
      const mappings = settings?.tag_mappings ?? {}

      const data = tags.map((tag) => ({
        count: tag.count,
        current_name: mappings[tag.tagKey] ?? null,
        latest_time: tag.latestTime.toISOString(),
        tag_key: tag.tagKey,
      }))

      return jsonResponse({ data, success: true })
    },
  )

  // Tool: set_tag_mapping
  server.tool(
    'set_tag_mapping',
    'Set a display name for a programmatic tag (UUID, tag_* prefix, etc.). Use after get_programmatic_tags to name unmapped tags.',
    {
      name: z.string().min(1).describe('Display name for the tag'),
      tag_key: z.string().min(1).describe('The programmatic tag identifier (UUID, tag_* prefix, etc.)'),
    },
    async ({ name, tag_key }) => {
      const settings = await getUserSettings(user)
      const currentMappings = settings?.tag_mappings ?? {}
      const newMappings = { ...currentMappings, [tag_key]: name }

      await upsertUserSettings(user, { tag_mappings: newMappings })

      return jsonResponse({ mapping: newMappings, success: true })
    },
  )

  // Tool: get_tag_mappings
  server.tool('get_tag_mappings', 'Get all current tag mappings (tag key -> display name).', {}, async () => {
    const settings = await getUserSettings(user)
    return jsonResponse({ mappings: settings?.tag_mappings ?? {}, success: true })
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
