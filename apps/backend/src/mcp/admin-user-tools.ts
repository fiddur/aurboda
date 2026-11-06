import { adminUserUsageQuerySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import type { AdminUsers } from '../services/admin-users.ts'
import type { CentralDb } from '../services/central-db.ts'

import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerAdminUserTools = (
  server: McpServer,
  user: string,
  centralDb: CentralDb,
  adminUsers: AdminUsers,
) => {
  const requireAdmin = async (): Promise<string | null> =>
    (await centralDb.isAdmin(user)) ? null : 'Admin permission required'

  server.tool(
    'list_users',
    'List every user on this installation with signup date, database size, how often data comes in (ingest per day over 7 and 30 days, sources) and when and how much they use the web app, Android app, MCP and API. Admin-only.',
    {},
    async () => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      return jsonResponse({ success: true, users: await adminUsers.listUsersOverview() })
    },
  )

  server.tool(
    'get_user_usage',
    "Get one user's daily usage (reads and writes per channel, ingest per data source) over the last `days` days, with database size and largest tables. Admin-only.",
    { username: z.string().min(1).describe('Username'), ...adminUserUsageQuerySchema.shape },
    async ({ username, days }) => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      const usage = await adminUsers.getUserUsage(username, days)
      if (!usage) return errorResponse('User not found')
      return jsonResponse({ success: true, user: usage })
    },
  )
}
