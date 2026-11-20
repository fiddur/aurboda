import type { BaseResponse } from '@aurboda/api-spec'
import type { Request, Response } from 'express'

import type { LiveEventKind, LiveHub } from '../services/live-hub.ts'

import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'

const HEARTBEAT_MS = 25_000

export type LiveEventChunk = (kind: LiveEventKind) => string | null

/**
 * Serve a user's live pings as Server-Sent Events until the client goes away.
 * Each event is a bare "refetch" signal with an empty payload. When the live
 * channel cannot be opened the stream ends, and the client falls back to polling.
 */
export const serveLiveStream = async (
  req: Request,
  res: Response,
  user: string,
  hub: LiveHub,
  toChunk: LiveEventChunk,
): Promise<void> => {
  // `X-Accel-Buffering: no` keeps nginx from holding events back for a full response body.
  res.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  })
  const write = (chunk: string) => {
    if (res.writableEnded) return
    try {
      res.write(chunk)
    } catch {
      /* client vanished mid-write */
    }
  }
  write(': connected\n\n')

  // Comment heartbeats keep the connection from being reaped as idle.
  const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS)
  let unsubscribe: (() => Promise<void>) | null = null
  let closed = false
  const cleanup = async () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    if (unsubscribe) await unsubscribe().catch(() => {})
  }
  req.on('close', () => void cleanup())

  try {
    unsubscribe = await hub.subscribe(user, (kind) => {
      const chunk = toChunk(kind)
      if (chunk != null) write(chunk)
    })
    // The client may have disconnected while the channel was opening.
    if (closed) await unsubscribe().catch(() => {})
  } catch {
    await cleanup()
    if (!res.writableEnded) res.end()
  }
}

export const LIVE_UNAVAILABLE: BaseResponse = { error: 'Live updates unavailable', success: false }

export const createEventsRouter = (authMiddleware: AnyMiddleware, hub?: LiveHub): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, BaseResponse>('/stream', authMiddleware, async (req, res) => {
    if (!hub) return res.status(503).json(LIVE_UNAVAILABLE)
    await serveLiveStream(req, res, req.user!, hub, (kind) => `event: ${kind}\ndata: {}\n\n`)
  })

  return router
}
