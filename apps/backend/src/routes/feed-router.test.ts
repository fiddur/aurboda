import type { RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'

import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import type { TimelineHub } from '../services/timeline-hub.ts'

import { createFeedRouter } from './feed-router.ts'

/** Stand-in auth that just sets the acting user, like the real middleware does. */
const auth: RequestHandler = (req, _res, next) => {
  req.user = 'tester'
  next()
}

/** A fake hub that captures the SSE listener so the test can fire pings, and records teardown. */
const fakeHub = () => {
  let fire: (() => void) | null = null
  let unsubscribed = false
  const hub: TimelineHub = {
    notify: async () => {},
    subscribe: async (_user, onEvent) => {
      fire = onEvent
      return async () => {
        unsubscribed = true
      }
    },
  }
  return { fire: () => fire?.(), hub, wasUnsubscribed: () => unsubscribed }
}

const startApp = (hub?: TimelineHub) => {
  const app = express()
  app.use('/feed', createFeedRouter(auth, undefined, hub))
  const server = app.listen(0)
  const port = (server.address() as AddressInfo).port
  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  return { close, url: `http://127.0.0.1:${port}` }
}

describe('GET /feed/timeline/stream', () => {
  test('returns 503 when live updates are unavailable (no hub wired)', async () => {
    const app = express()
    app.use('/feed', createFeedRouter(auth, undefined, undefined))
    const res = await supertest(app).get('/feed/timeline/stream')
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: 'Live updates unavailable', success: false })
  })

  test('opens an SSE stream and forwards a hub ping as `event: new`', async () => {
    const { hub, fire } = fakeHub()
    const { url, close } = startApp(hub)
    const ctrl = new AbortController()
    try {
      const res = await fetch(`${url}/feed/timeline/stream`, { signal: ctrl.signal })
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      expect(res.headers.get('x-accel-buffering')).toBe('no')

      const reader = res.body?.getReader()
      if (!reader) throw new Error('no response body')
      const decoder = new TextDecoder()

      const connected = await reader.read()
      expect(decoder.decode(connected.value)).toContain(': connected')

      fire()
      const event = await reader.read()
      expect(decoder.decode(event.value)).toContain('event: new')

      ctrl.abort()
      await reader.cancel().catch(() => {})
    } finally {
      await close()
    }
  })

  test('unsubscribes from the hub when the client disconnects', async () => {
    const { hub, wasUnsubscribed } = fakeHub()
    const { url, close } = startApp(hub)
    const ctrl = new AbortController()
    try {
      const res = await fetch(`${url}/feed/timeline/stream`, { signal: ctrl.signal })
      const reader = res.body?.getReader()
      if (!reader) throw new Error('no response body')
      await reader.read() // wait until the stream is live (subscribed)
      ctrl.abort()
      await reader.cancel().catch(() => {})
      // The server-side 'close' → cleanup is async; poll briefly for the teardown.
      for (let i = 0; i < 50 && !wasUnsubscribed(); i++) await new Promise((r) => setTimeout(r, 20))
      expect(wasUnsubscribed()).toBe(true)
    } finally {
      await close()
    }
  })
})
