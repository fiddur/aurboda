/**
 * MCP user settings and tag mapping tools.
 */
import { setTagMappingBodySchema, updateSettingsInputSchema } from '@aurboda/api-spec'
import {
  getProgrammaticTags,
  getUniqueTags,
  getUserSettings,
  updateTagNameByKey,
  upsertUserSettings,
} from '../db'
import { getGoalsProgress } from '../services/goals'
import { getSettingsResponse, validateAndUpdateSettings } from '../services/settings'
import { jsonResponse, type McpServer } from './helpers'

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
    { ...updateSettingsInputSchema.shape },
    async (params) => {
      const result = await validateAndUpdateSettings(user, params)
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
    'Get all tags available for mapping. Includes programmatic tags (UUIDs, tag_* prefixes) that need human-readable display names, plus all other tags so icons can be set on any tag. Tags with is_programmatic=true and no current_name are unmapped.',
    {},
    async () => {
      const tags = await getProgrammaticTags(user)
      const settings = await getUserSettings(user)
      const mappings = settings?.tag_mappings ?? {}

      const data = tags.map((tag) => ({
        count: tag.count,
        current_name: tag.isProgrammatic ? (mappings[tag.tagKey] ?? null) : tag.tagKey,
        is_programmatic: tag.isProgrammatic,
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
    { ...setTagMappingBodySchema.shape },
    async ({ name, tag_key, icon }) => {
      const settings = await getUserSettings(user)
      const currentMappings = settings?.tag_mappings ?? {}
      const newMappings = { ...currentMappings, [tag_key]: name }

      const updates: { tag_mappings: Record<string, string>; item_icons?: Record<string, string> } = {
        tag_mappings: newMappings,
      }
      if (icon !== undefined) {
        const currentIcons = settings?.item_icons ?? {}
        if (icon) {
          updates.item_icons = { ...currentIcons, [name]: icon }
        } else {
          const newIcons = { ...currentIcons }
          delete newIcons[name]
          delete newIcons[tag_key]
          updates.item_icons = newIcons
        }
      }

      await upsertUserSettings(user, updates)
      await updateTagNameByKey(user, tag_key, name)

      return jsonResponse({ mapping: newMappings, success: true })
    },
  )

  // Tool: get_tag_mappings
  server.tool('get_tag_mappings', 'Get all current tag mappings (tag key -> display name).', {}, async () => {
    const settings = await getUserSettings(user)
    return jsonResponse({
      icons: settings?.item_icons ?? {},
      mappings: settings?.tag_mappings ?? {},
      success: true,
    })
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
