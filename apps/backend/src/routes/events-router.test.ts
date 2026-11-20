import type { RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'

import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import type { LiveEventKind, LiveHub } from '../services/live-hub.ts'

import { createEventsRouter } from './events-router.ts'

const auth: RequestHandler = (req, _res, next) => {
  req.user = 'tester'
  next()
}

const fakeHub = (failOpen = false) => {
  let fire: ((kind: LiveEventKind) => void) | null = null
  let subscribedUser: string | null = null
  let unsubscribed = false
  const hub: LiveHub = {
    notify: async () => {},
    subscribe: async (user, onEvent) => {
      if (failOpen) throw new Error('LISTEN failed')
      subscribedUser = user
      fire = onEvent
      return async () => {
        unsubscribed = true
      }
    },
  }
  return {
    fire: (kind: LiveEventKind) => fire?.(kind),
    hub,
    subscribedUser: () => subscribedUser,
    wasUnsubscribed: () => unsubscribed,
  }
}

const startApp = (hub?: LiveHub) => {
  const app = express()
  app.use('/events', createEventsRouter(auth, hub))
  const server = app.listen(0)
  const port = (server.address() as AddressInfo).port
  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  return { close, url: `http://127.0.0.1:${port}` }
}

const openStream = async (url: string, signal: AbortSignal) => {
  const res = await fetch(`${url}/events/stream`, { signal })
  const reader = res.body?.getReader()
  if (!reader) throw new Error('no response body')
  const decoder = new TextDecoder()
  const read = async () => {
    const { done, value } = await reader.read()
    return done ? null : decoder.decode(value)
  }
  return { read, reader, res }
}

describe('GET /events/stream', () => {
  test('503 when live updates are unavailable (no hub wired)', async () => {
    const app = express()
    app.use('/events', createEventsRouter(auth))
    const res = await supertest(app).get('/events/stream')
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: 'Live updates unavailable', success: false })
  })

  test('writes each kind of ping under its own event name', async () => {
    const { hub, fire, subscribedUser } = fakeHub()
    const { url, close } = startApp(hub)
    const ctrl = new AbortController()
    try {
      const { read, reader, res } = await openStream(url, ctrl.signal)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      expect(res.headers.get('x-accel-buffering')).toBe('no')
      expect(await read()).toContain(': connected')
      expect(subscribedUser()).toBe('tester')

      fire('timeline')
      expect(await read()).toBe('event: timeline\ndata: {}\n\n')
      fire('notification')
      expect(await read()).toBe('event: notification\ndata: {}\n\n')

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
      const { read, reader } = await openStream(url, ctrl.signal)
      await read()
      ctrl.abort()
      await reader.cancel().catch(() => {})
      for (let i = 0; i < 50 && !wasUnsubscribed(); i++) await new Promise((r) => setTimeout(r, 20))
      expect(wasUnsubscribed()).toBe(true)
    } finally {
      await close()
    }
  })

  test('a ping that arrives while the channel opens is written once the stream starts', async () => {
    const hub: LiveHub = {
      notify: async () => {},
      subscribe: async (_user, onEvent) => {
        onEvent('notification')
        return async () => {}
      },
    }
    const { url, close } = startApp(hub)
    const ctrl = new AbortController()
    try {
      const { read, reader } = await openStream(url, ctrl.signal)
      let text = ''
      while (!text.includes('event: notification')) text += (await read()) ?? ''
      expect(text).toBe(': connected\n\nevent: notification\ndata: {}\n\n')
      ctrl.abort()
      await reader.cancel().catch(() => {})
    } finally {
      await close()
    }
  })

  test('503 when the live channel cannot be opened, so the client backs off', async () => {
    const { hub } = fakeHub(true)
    const { url, close } = startApp(hub)
    try {
      const res = await fetch(`${url}/events/stream`)
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'Live updates unavailable', success: false })
    } finally {
      await close()
    }
  })
})
