/**
 * MCP screentime category management tools.
 */
import { createScreentimeCategoryBodySchema, updateScreentimeCategoryBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'
import {
  createCategory,
  fetchAwCategories,
  importFromActivityWatch,
  listCategories,
  modifyCategory,
  recategorizeAll,
  removeCategory,
} from '../services/screentime-categories'
import { errorResponse, jsonResponse, type McpServer } from './helpers'

export const registerScreentimeCategoryTools = (server: McpServer, user: string) => {
  // Tool: list_screentime_categories
  server.tool(
    'list_screentime_categories',
    'List all screentime categories. Returns hierarchical category rules used to categorize app/website usage.',
    {},
    async () => {
      const categories = await listCategories(user)
      return jsonResponse(categories)
    },
  )

  // Tool: add_screentime_category
  server.tool(
    'add_screentime_category',
    'Add a screentime category rule. Categories match app names and window titles using regex. Hierarchical: ["Work", "Programming"] is a child of ["Work"]. Triggers recategorization of all existing records.',
    { ...createScreentimeCategoryBodySchema.shape },
    async (params) => {
      const category = await createCategory(user, {
        color: params.color,
        ignore_case: params.ignore_case ?? true,
        name: params.name,
        rule_regex: params.rule_regex,
        rule_type: params.rule_type ?? 'none',
        score: params.score,
        sort_order: params.sort_order,
      })
      return jsonResponse(category)
    },
  )

  // Tool: update_screentime_category
  server.tool(
    'update_screentime_category',
    'Update a screentime category. Only provided fields are changed. Triggers recategorization if rules or name changed.',
    {
      id: z.string().uuid().meta({ description: 'Category ID to update' }),
      ...updateScreentimeCategoryBodySchema.shape,
    },
    async ({ id, ...params }) => {
      const category = await modifyCategory(user, id, params)
      if (!category) return errorResponse('Category not found')
      return jsonResponse(category)
    },
  )

  // Tool: delete_screentime_category
  server.tool(
    'delete_screentime_category',
    'Delete a screentime category and all its children. Triggers recategorization.',
    { id: z.string().uuid().meta({ description: 'Category ID to delete' }) },
    async ({ id }) => {
      const count = await removeCategory(user, id)
      if (count === 0) return errorResponse('Category not found')
      return jsonResponse({ deleted: count, success: true })
    },
  )

  // Tool: import_activitywatch_categories
  server.tool(
    'import_activitywatch_categories',
    "Import screentime categories from an ActivityWatch server. Fetches the category configuration from AW's settings API and imports them.",
    {
      replace: z.boolean().optional().meta({ description: 'If true, replace all existing categories' }),
      url: z
        .string()
        .optional()
        .meta({ description: 'ActivityWatch server URL (defaults to http://localhost:5600)' }),
    },
    async ({ replace, url }) => {
      try {
        const serverUrl = url || 'http://localhost:5600'
        const awCategories = await fetchAwCategories(serverUrl)
        const result = await importFromActivityWatch(user, awCategories, replace ?? false)
        return jsonResponse({ imported: result.length, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Import failed'
        return errorResponse(message)
      }
    },
  )

  // Tool: recategorize_screentime
  server.tool(
    'recategorize_screentime',
    'Force recategorization of all screentime records against current category rules. Use after bulk rule changes.',
    {},
    async () => {
      const count = await recategorizeAll(user)
      return jsonResponse({ records_updated: count, success: true })
    },
  )
}
