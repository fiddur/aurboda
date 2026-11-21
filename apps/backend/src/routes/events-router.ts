import type { BaseResponse } from '@aurboda/api-spec'
import type { Request, Response } from 'express'

import type { LiveEventKind, LiveHub } from '../services/live-hub.ts'

import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'

const HEARTBEAT_MS = 25_000

export type LiveEventChunk = (kind: LiveEventKind) => string | null

export const LIVE_UNAVAILABLE: BaseResponse = { error: 'Live updates unavailable', success: false }

/**
 * Serve a user's live pings as Server-Sent Events until the client goes away.
 * Each event is a bare "refetch" signal with an empty payload. The channel is opened before
 * the response starts, so a failure to open it answers 503 and the client backs off and polls,
 * where a 200 that ends at once would read as a healthy stream to reconnect to right away.
 * When the channel drops after the stream started, the response ends, so the client reconnects.
 */
export const serveLiveStream = async (
  req: Request,
  res: Response,
  user: string,
  hub: LiveHub,
  toChunk: LiveEventChunk,
): Promise<void> => {
  let closed = false
  let started = false
  let unsubscribe: (() => Promise<void>) | null = null
  const beforeStart: string[] = []
  const write = (chunk: string) => {
    if (!started) return void beforeStart.push(chunk)
    if (res.writableEnded) return
    try {
      res.write(chunk)
    } catch {
      /* client vanished mid-write */
    }
  }
  // Comment heartbeats keep the connection from being reaped as idle.
  const heartbeat = setInterval(() => {
    if (started) write(': ping\n\n')
  }, HEARTBEAT_MS)
  const cleanup = async () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    if (unsubscribe) await unsubscribe().catch(() => {})
  }
  req.on('close', () => void cleanup())

  let channelDropped = false
  const onChannelClosed = () => {
    channelDropped = true
    if (!started) return
    void cleanup()
    if (!res.writableEnded) res.end()
  }

  try {
    unsubscribe = await hub.subscribe(
      user,
      (kind) => {
        const chunk = toChunk(kind)
        if (chunk != null) write(chunk)
      },
      onChannelClosed,
    )
  } catch {
    closed = true
    clearInterval(heartbeat)
    if (!res.headersSent) res.status(503).json(LIVE_UNAVAILABLE)
    return
  }
  // The client may have disconnected while the channel was opening.
  if (closed) return void (await unsubscribe().catch(() => {}))
  if (channelDropped) {
    await cleanup()
    return void res.status(503).json(LIVE_UNAVAILABLE)
  }

  // `X-Accel-Buffering: no` keeps nginx from holding events back for a full response body.
  res.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  })
  started = true
  write(': connected\n\n')
  for (const chunk of beforeStart) write(chunk)
}

export const createEventsRouter = (authMiddleware: AnyMiddleware, hub?: LiveHub): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, BaseResponse>('/stream', authMiddleware, async (req, res) => {
    if (!hub) return res.status(503).json(LIVE_UNAVAILABLE)
    await serveLiveStream(req, res, req.user!, hub, (kind) => `event: ${kind}\ndata: {}\n\n`)
  })

  return router
}
