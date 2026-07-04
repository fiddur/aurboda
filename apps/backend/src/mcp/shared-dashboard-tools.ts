/**
 * MCP shared dashboard tools.
 *
 * CRUD for the user's published dashboards (the same capability as the
 * `/shared-dashboards` REST endpoints). Public viewing is web-only and has no
 * MCP tool. Responses include the `slug` so a URL can be constructed; the
 * absolute share URL is provided by the REST layer.
 */
import { createSharedDashboardBodySchema, updateSharedDashboardBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import type { SharedDashboardRecord } from '../db/index.ts'

import {
  createSharedDashboard,
  deleteSharedDashboard,
  getSharedDashboardById,
  listSharedDashboards,
  updateSharedDashboard,
} from '../db/index.ts'
import { isPublicToVisibility, visibilityToIsPublic } from '../services/visibility.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

const serialize = (record: SharedDashboardRecord) => ({
  config: record.config,
  created_at: record.created_at.toISOString(),
  id: record.id,
  name: record.name,
  slug: record.slug,
  updated_at: record.updated_at.toISOString(),
  visibility: isPublicToVisibility(record.is_public),
})

export const registerSharedDashboardTools = (server: McpServer, user: string) => {
  server.tool(
    'list_shared_dashboards',
    'List the user’s shared dashboards (published, independently-editable copies of a dashboard config). Includes the slug, name, visibility, and config for each.',
    {},
    async () => {
      const records = await listSharedDashboards(user)
      return jsonResponse(records.map(serialize))
    },
  )

  server.tool(
    'create_shared_dashboard',
    'Create a shared dashboard from a dashboard config. Set visibility to "public" to list it on the public profile; "unlisted" (default) keeps it reachable only via its slug.',
    { ...createSharedDashboardBodySchema.shape },
    async (params) => {
      const record = await createSharedDashboard(user, {
        config: params.config,
        is_public: visibilityToIsPublic(params.visibility),
        name: params.name,
      })
      return jsonResponse(serialize(record))
    },
  )

  server.tool(
    'update_shared_dashboard',
    'Update a shared dashboard’s name, config, and/or visibility. The slug never changes. Only provided fields are modified.',
    { id: z.string().uuid().describe('The shared dashboard ID'), ...updateSharedDashboardBodySchema.shape },
    async ({ id, visibility, ...patch }) => {
      const record = await updateSharedDashboard(user, id, {
        ...patch,
        is_public: visibility === undefined ? undefined : visibilityToIsPublic(visibility),
      })
      if (!record) return errorResponse('Shared dashboard not found')
      return jsonResponse(serialize(record))
    },
  )

  server.tool(
    'delete_shared_dashboard',
    'Delete a shared dashboard by ID. Its slug stops resolving immediately.',
    { id: z.string().uuid().describe('The shared dashboard ID') },
    async ({ id }) => {
      const existing = await getSharedDashboardById(user, id)
      if (!existing) return errorResponse('Shared dashboard not found')
      await deleteSharedDashboard(user, id)
      return jsonResponse({ deleted: true, id })
    },
  )
}
