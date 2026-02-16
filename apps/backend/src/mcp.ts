/**
 * MCP server router with session management.
 *
 * Tool registrations are split into focused modules under mcp/.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomUUID } from 'crypto'
import { Request, Response, Router } from 'express'
import { Auth } from './auth'
import { DEFAULT_SESSION_INACTIVITY_MS, McpSessionStore } from './mcp-session-store'
import { registerActivityTools } from './mcp/activity-tools'
import { registerCorrelationTools } from './mcp/correlation-tools'
import { registerLastFmTools } from './mcp/lastfm-tools'
import { registerLocationTools } from './mcp/location-tools'
import { registerMetricTools } from './mcp/metric-tools'
import { registerQueryTools } from './mcp/query-tools'
import { registerSettingsTools } from './mcp/settings-tools'
import { registerSyncTools } from './mcp/sync-tools'
import { registerTagTools } from './mcp/tag-tools'
import { registerTrendTools } from './mcp/trend-tools'
import { ouraClient } from './oura'
import { SyncProvider } from './services/queries'

interface McpSession {
  transport: StreamableHTTPServerTransport
  server: McpServer
  user: string
}

type OuraClientType = ReturnType<typeof ouraClient>

/**
 * Create an MCP router with optional session persistence.
 *
 * When a sessionStore is provided, sessions are persisted to the database
 * and can survive backend restarts. When a client reconnects with a
 * previously-issued session ID, the session is lazily restored.
 */
export function createMcpRouter(
  auth: Auth,
  oura?: OuraClientType,
  sync?: SyncProvider,
  options?: { sessionStore?: McpSessionStore; cleanupIntervalMs?: number },
): Router {
  const router = Router()
  const sessions = new Map<string, McpSession>()
  const sessionStore = options?.sessionStore
  const cleanupIntervalMs = options?.cleanupIntervalMs ?? 60 * 60 * 1000 // Default: 1 hour

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

  const createMcpServer = (user: string): McpServer => {
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
    registerTrendTools(server, user)

    return server
  }

  // Helper to restore a session from the store (lazy restoration after restart)
  const restoreSessionFromStore = async (user: string, sessionId: string): Promise<McpSession | null> => {
    if (!sessionStore) {
      console.log('[MCP] restoreSessionFromStore: no sessionStore configured')
      return null
    }

    console.log(`[MCP] restoreSessionFromStore: attempting to restore session ${sessionId} for user ${user}`)
    const record = await sessionStore.get(user, sessionId)
    if (!record) {
      console.log(`[MCP] restoreSessionFromStore: session ${sessionId} not found in store`)
      return null
    }
    if (record.username !== user) {
      console.log(
        `[MCP] restoreSessionFromStore: session ${sessionId} belongs to ${record.username}, not ${user}`,
      )
      return null
    }

    // Check if session is expired (older than 7 days by default)
    const maxAge = DEFAULT_SESSION_INACTIVITY_MS
    const age = Date.now() - record.last_activity.getTime()
    console.log(
      `[MCP] restoreSessionFromStore: session ${sessionId} age=${age}ms, maxAge=${maxAge}ms, lastActivity=${record.last_activity.toISOString()}`,
    )
    if (age > maxAge) {
      // Session expired - clean it up
      console.log(`[MCP] restoreSessionFromStore: session ${sessionId} expired, deleting`)
      await sessionStore.delete(user, sessionId)
      return null
    }

    // Recreate the McpServer and transport
    console.log(`[MCP] restoreSessionFromStore: recreating McpServer for session ${sessionId}`)
    const server = createMcpServer(user)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    })

    await server.connect(transport)

    const session: McpSession = { server, transport, user }
    sessions.set(sessionId, session)

    console.log(`[MCP] restoreSessionFromStore: session ${sessionId} restored successfully`)
    return session
  }

  // Periodic cleanup of in-memory sessions that have no recent activity
  // This runs on an interval to free memory from abandoned sessions
  let cleanupTimer: ReturnType<typeof setInterval> | undefined
  if (sessionStore) {
    cleanupTimer = setInterval(async () => {
      const now = Date.now()
      for (const [sessionId, session] of sessions) {
        // Check store for last activity
        const record = await sessionStore.get(session.user, sessionId)
        if (!record || now - record.last_activity.getTime() > DEFAULT_SESSION_INACTIVITY_MS) {
          // Close and remove stale session
          await session.server.close()
          sessions.delete(sessionId)
          if (record) {
            await sessionStore.delete(session.user, sessionId)
          }
        }
      }
    }, cleanupIntervalMs)

    // Don't let the timer prevent process exit
    cleanupTimer.unref()
  }

  // POST /mcp - Handle JSON-RPC requests
  // eslint-disable-next-line complexity -- TODO: refactor
  router.post('/', async (req: Request, res: Response) => {
    const user = getAuthenticatedUser(req)
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined
    console.log(
      `[MCP] POST request: user=${user}, sessionId=${sessionId ?? 'none'}, hasStore=${!!sessionStore}`,
    )

    let session: McpSession | undefined

    if (sessionId && sessions.has(sessionId)) {
      // Session is in memory
      console.log(`[MCP] POST: session ${sessionId} found in memory`)
      session = sessions.get(sessionId)!
      if (session.user !== user) {
        res.status(403).json({ error: 'Session belongs to different user' })
        return
      }
    } else if (sessionId && sessionStore) {
      // Session not in memory - try to restore from store
      console.log(`[MCP] POST: session ${sessionId} not in memory, attempting restore from store`)
      try {
        const restored = await restoreSessionFromStore(user, sessionId)
        if (restored) {
          session = restored
        }
      } catch (err) {
        console.error(`[MCP] POST: error restoring session ${sessionId}:`, err)
        // Continue to create new session
      }
    }

    if (!session) {
      // Create new session - generate ID first so transport and our map use the same one
      const newSessionId = randomUUID()
      console.log(`[MCP] POST: creating new session ${newSessionId} for user ${user}`)
      const server = createMcpServer(user)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      })

      await server.connect(transport)

      session = { server, transport, user }
      sessions.set(newSessionId, session)

      // Persist to store if available
      if (sessionStore) {
        console.log(`[MCP] POST: saving new session ${newSessionId} to store`)
        try {
          await sessionStore.save(user, newSessionId)
        } catch (err) {
          console.error(`[MCP] POST: error saving session ${newSessionId}:`, err)
          // Continue without persistence
        }
      }
    }

    await session.transport.handleRequest(req, res)

    // Update last activity in store
    if (sessionStore && sessionId) {
      try {
        await sessionStore.touch(user, sessionId)
      } catch (err) {
        console.error(`[MCP] POST: error touching session ${sessionId}:`, err)
      }
    }
  })

  // GET /mcp - SSE stream for server notifications
  router.get('/', async (req: Request, res: Response) => {
    const user = getAuthenticatedUser(req)
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (!sessionId) {
      res.status(400).json({ error: 'Invalid or missing session ID' })
      return
    }

    let session = sessions.get(sessionId)

    // Try to restore from store if not in memory
    if (!session && sessionStore) {
      session = (await restoreSessionFromStore(user, sessionId)) ?? undefined
    }

    if (!session) {
      res.status(400).json({ error: 'Invalid or missing session ID' })
      return
    }

    if (session.user !== user) {
      res.status(403).json({ error: 'Session belongs to different user' })
      return
    }

    await session.transport.handleRequest(req, res)

    // Update last activity in store
    if (sessionStore) {
      await sessionStore.touch(user, sessionId)
    }
  })

  // DELETE /mcp - End session
  router.delete('/', async (req: Request, res: Response) => {
    const user = getAuthenticatedUser(req)
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (!sessionId) {
      res.status(400).json({ error: 'Invalid or missing session ID' })
      return
    }

    let session = sessions.get(sessionId)

    // Try to restore from store if not in memory (so we can properly close it)
    if (!session && sessionStore) {
      session = (await restoreSessionFromStore(user, sessionId)) ?? undefined
    }

    if (!session) {
      res.status(400).json({ error: 'Invalid or missing session ID' })
      return
    }

    if (session.user !== user) {
      res.status(403).json({ error: 'Session belongs to different user' })
      return
    }

    await session.transport.handleRequest(req, res)
    await session.server.close()
    sessions.delete(sessionId)

    // Also delete from store
    if (sessionStore) {
      await sessionStore.delete(user, sessionId)
    }
  })

  return router
}
