/**
 * Stateless MCP server router.
 *
 * Each request creates a fresh McpServer + transport pair. No session tracking
 * is needed since the server only exposes tools (no resources, subscriptions,
 * or server-initiated notifications).
 *
 * Tool registrations are split into focused modules under mcp/.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { type Request, type Response, Router } from 'express'

import type { Auth } from './auth.ts'
import type { GarminClient } from './garmin.ts'
import type { ouraClient } from './oura.ts'
import type { SyncProvider } from './services/queries.ts'

import { registerActivityTools } from './mcp/activity-tools.ts'
import { registerCorrelationTools } from './mcp/correlation-tools.ts'
import { registerLastFmTools } from './mcp/lastfm-tools.ts'
import { registerLocationTools } from './mcp/location-tools.ts'
import { registerMealTools } from './mcp/meal-tools.ts'
import { registerMetricTools } from './mcp/metric-tools.ts'
import { registerNoteTools } from './mcp/note-tools.ts'
import { registerQueryTools } from './mcp/query-tools.ts'
import { registerReportTools } from './mcp/report-tools.ts'
import { registerScreentimeCategoryTools } from './mcp/screentime-category-tools.ts'
import { registerSettingsTools } from './mcp/settings-tools.ts'
import { registerSyncTools } from './mcp/sync-tools.ts'
import { registerTagTools } from './mcp/tag-tools.ts'
import { registerTrainingLoadTools } from './mcp/training-load-tools.ts'
import { registerTrendTools } from './mcp/trend-tools.ts'

type OuraClientType = ReturnType<typeof ouraClient>

interface McpDeps {
  garmin?: GarminClient
  oura?: OuraClientType
  sync?: SyncProvider
}

const createMcpServer = (user: string, deps: McpDeps = {}): McpServer => {
  const server = new McpServer({
    name: 'aurboda',
    version: '1.0.0',
  })

  registerQueryTools(server, user, deps.sync)
  registerTagTools(server, user)
  registerMetricTools(server, user)
  registerActivityTools(server, user)
  registerSyncTools(server, user, deps.oura, deps.garmin)
  registerLastFmTools(server, user)
  registerSettingsTools(server, user)
  registerLocationTools(server, user)
  registerCorrelationTools(server, user, deps.sync)
  registerTrainingLoadTools(server, user)
  registerTrendTools(server, user)
  registerNoteTools(server, user)
  registerMealTools(server, user)
  registerReportTools(server, user)
  registerScreentimeCategoryTools(server, user)

  return server
}

/**
 * Create a stateless MCP router.
 *
 * Each POST request creates a fresh McpServer and transport. No session
 * persistence or tracking is needed — the server only exposes tools with
 * no server-initiated notifications.
 */
export function createMcpRouter(auth: Auth, deps: McpDeps = {}): Router {
  const router = Router()

  const getAuthenticatedUser = (req: Request): string | null => {
    const authHeader = req.headers.authorization
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return null
    }
    try {
      const token = authHeader.slice('Bearer '.length)
      return auth.getUsernameFromToken(token)
    } catch {
      return null
    }
  }

  // POST /mcp - Handle JSON-RPC requests (stateless: fresh server per request)
  router.post('/', async (req: Request, res: Response) => {
    const user = getAuthenticatedUser(req)
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const server = createMcpServer(user, deps)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    })

    await server.connect(transport)
    await transport.handleRequest(req, res)
    await server.close()
  })

  // GET /mcp - Not used in stateless mode (no SSE notifications)
  router.get('/', (_req: Request, res: Response) => {
    res.status(405).json({ error: 'SSE not supported in stateless mode' })
  })

  // DELETE /mcp - Not used in stateless mode (no sessions)
  router.delete('/', (_req: Request, res: Response) => {
    res.status(405).json({ error: 'No sessions in stateless mode' })
  })

  return router
}
