import type { RequestHandler } from 'express'

import type { UsageKind } from '../services/usage-recorder.ts'

import { classifyClient } from '../services/usage-channel.ts'

type RecordUsage = (username: string, kind: UsageKind, channel: string) => void

const isMcpPath = (url: string): boolean =>
  url === '/mcp' || url.startsWith('/mcp/') || url.startsWith('/mcp?')

/**
 * Counts successful authenticated REST requests. Mounted before the routers,
 * so it reads `req.user` when the response finishes, after `authMiddleware`
 * set it. MCP is counted per tool call by its own router, never here.
 */
export const createUsageMiddleware =
  (recordUsage: RecordUsage): RequestHandler =>
  (req, res, next) => {
    if (req.method !== 'OPTIONS' && !isMcpPath(req.originalUrl)) {
      res.on('finish', () => {
        if (!req.user || res.statusCode >= 400) return
        const kind: UsageKind = req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'write'
        recordUsage(req.user, kind, classifyClient(req.headers))
      })
    }
    next()
  }
