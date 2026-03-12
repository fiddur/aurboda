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
import { Request, Response, Router } from 'express'
import { Auth } from './auth'
import { registerActivityTools } from './mcp/activity-tools'
import { registerCorrelationTools } from './mcp/correlation-tools'
import { registerLastFmTools } from './mcp/lastfm-tools'
import { registerLocationTools } from './mcp/location-tools'
import { registerMealTools } from './mcp/meal-tools'
import { registerMetricTools } from './mcp/metric-tools'
import { registerNoteTools } from './mcp/note-tools'
import { registerQueryTools } from './mcp/query-tools'
import { registerReportTools } from './mcp/report-tools'
import { registerScreentimeCategoryTools } from './mcp/screentime-category-tools'
import { registerSettingsTools } from './mcp/settings-tools'
import { registerSyncTools } from './mcp/sync-tools'
import { registerTagTools } from './mcp/tag-tools'
import { registerTrainingLoadTools } from './mcp/training-load-tools'
import { registerTrendTools } from './mcp/trend-tools'
import { ouraClient } from './oura'
import { SyncProvider } from './services/queries'

type OuraClientType = ReturnType<typeof ouraClient>

const createMcpServer = (user: string, oura?: OuraClientType, sync?: SyncProvider): McpServer => {
  const server = new McpServer({
    name: 'aurboda',
    version: '1.0.0',
  })

  registerQueryTools(server, user, sync)
  registerTagTools(server, user)
  registerMetricTools(server, user)
  registerActivityTools(server, user)
  registerSyncTools(server, user, oura)
  registerLastFmTools(server, user)
  registerSettingsTools(server, user)
  registerLocationTools(server, user)
  registerCorrelationTools(server, user, sync)
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
export function createMcpRouter(auth: Auth, oura?: OuraClientType, sync?: SyncProvider): Router {
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

    const server = createMcpServer(user, oura, sync)
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
