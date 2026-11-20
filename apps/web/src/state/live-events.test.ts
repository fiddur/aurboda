import { describe, expect, test, vi } from 'vitest'

import type { LiveEventKind } from './api/live-sse'

import {
  createLiveEvents,
  type LiveStreamHandlers as Handlers,
  retryDelayMs,
  shouldStreamBeOpen,
} from './live-events'

vi.mock('../config', () => ({ API_URL: 'http://api.test' }))
vi.mock('./auth', () => ({ auth: { subscribe: () => () => {}, value: {} } }))

describe('retryDelayMs', () => {
  test('backs off 5 s, 15 s, 60 s, then stays at 60 s', () => {
    expect([0, 1, 2, 3, 10].map(retryDelayMs)).toEqual([5_000, 15_000, 60_000, 60_000, 60_000])
  })
})

describe('shouldStreamBeOpen', () => {
  test('needs a subscriber, a token and a visible tab', () => {
    expect(shouldStreamBeOpen({ subscribers: 1, token: 't', visible: true })).toBe(true)
    expect(shouldStreamBeOpen({ subscribers: 0, token: 't', visible: true })).toBe(false)
    expect(shouldStreamBeOpen({ subscribers: 1, token: undefined, visible: true })).toBe(false)
    expect(shouldStreamBeOpen({ subscribers: 1, token: '', visible: true })).toBe(false)
    expect(shouldStreamBeOpen({ subscribers: 1, token: 't', visible: false })).toBe(false)
  })
})

const harness = () => {
  const streams: { token: string; handlers: Handlers; closed: boolean }[] = []
  const timers: { callback: () => void; ms: number; cleared: boolean }[] = []
  let token: string | undefined = 'tok'
  let visible = true
  let tokenListener = () => {}
  let visibilityListener = () => {}
  const live = createLiveEvents({
    clearTimer: (handle) => {
      ;(handle as { cleared: boolean }).cleared = true
    },
    getToken: () => token,
    isVisible: () => visible,
    onTokenChange: (listener) => {
      tokenListener = listener
    },
    onVisibilityChange: (listener) => {
      visibilityListener = listener
    },
    open: (t, handlers) => {
      const stream = { closed: false, handlers, token: t }
      streams.push(stream)
      return () => {
        stream.closed = true
      }
    },
    setTimer: (callback, ms) => {
      const timer = { callback, cleared: false, ms }
      timers.push(timer)
      return timer
    },
  })
  return {
    live,
    open: () => streams.filter((s) => !s.closed),
    setToken: (value: string | undefined) => {
      token = value
      tokenListener()
    },
    setVisible: (value: boolean) => {
      visible = value
      visibilityListener()
    },
    streams,
    timers,
  }
}

describe('createLiveEvents', () => {
  test('holds one stream for every subscriber and routes each kind to its own', () => {
    const h = harness()
    const timeline = vi.fn()
    const bell = vi.fn()
    h.live.subscribe('timeline', timeline)
    h.live.subscribe('notification', bell)
    expect(h.streams).toHaveLength(1)
    expect(h.streams[0].token).toBe('tok')

    h.streams[0].handlers.onOpen()
    h.streams[0].handlers.onEvent('notification')
    expect(bell).toHaveBeenCalledTimes(1)
    expect(timeline).not.toHaveBeenCalled()
  })

  test('closes the stream with the last subscriber', () => {
    const h = harness()
    const off1 = h.live.subscribe('timeline', vi.fn())
    const off2 = h.live.subscribe('notification', vi.fn())
    off1()
    expect(h.open()).toHaveLength(1)
    off2()
    expect(h.open()).toHaveLength(0)
  })

  test('closes when hidden and on visible reopens with one synthetic event for everyone', () => {
    const h = harness()
    const events: LiveEventKind[] = []
    h.live.subscribe('timeline', () => events.push('timeline'))
    h.live.subscribe('notification', () => events.push('notification'))
    h.setVisible(false)
    expect(h.open()).toHaveLength(0)
    expect(events).toEqual([])

    h.setVisible(true)
    expect(h.open()).toHaveLength(1)
    expect(events).toEqual(['timeline', 'notification'])
  })

  test('opens nothing while hidden or logged out', () => {
    const h = harness()
    h.setVisible(false)
    h.live.subscribe('timeline', vi.fn())
    expect(h.streams).toHaveLength(0)
    h.setVisible(true)
    expect(h.streams).toHaveLength(1)
    h.setToken(undefined)
    expect(h.open()).toHaveLength(0)
    h.setToken('other')
    expect(h.open().map((s) => s.token)).toEqual(['other'])
  })

  test('a drop reports the fallback and retries with backoff until it reopens', () => {
    const h = harness()
    const onEvent = vi.fn()
    const fallback: boolean[] = []
    h.live.subscribe('timeline', onEvent, (down) => fallback.push(down))

    h.streams[0].handlers.onEnd()
    expect(fallback).toEqual([true])
    expect(h.timers.map((t) => t.ms)).toEqual([5_000])

    h.timers[0].callback()
    h.streams[1].handlers.onEnd()
    h.timers[1].callback()
    h.streams[2].handlers.onEnd()
    h.timers[2].callback()
    h.streams[3].handlers.onEnd()
    expect(h.timers.map((t) => t.ms)).toEqual([5_000, 15_000, 60_000, 60_000])

    const late = vi.fn()
    h.live.subscribe('notification', vi.fn(), late)
    expect(late).toHaveBeenCalledWith(true)

    h.timers[3].callback()
    h.streams[4].handlers.onOpen()
    expect(fallback).toEqual([true, false])
    expect(onEvent).toHaveBeenCalledTimes(1)

    h.streams[4].handlers.onEnd()
    expect(h.timers[4].ms).toBe(5_000)
  })

  test('logging out cancels a pending retry and clears the fallback', () => {
    const h = harness()
    const fallback: boolean[] = []
    h.live.subscribe('timeline', vi.fn(), (down) => fallback.push(down))
    h.streams[0].handlers.onEnd()
    h.setToken(undefined)
    expect(h.timers[0].cleared).toBe(true)
    expect(fallback).toEqual([true, false])
  })

  test('events from a stream already closed are ignored', () => {
    const h = harness()
    const onEvent = vi.fn()
    const off = h.live.subscribe('timeline', onEvent)
    const old = h.streams[0]
    off()
    h.live.subscribe('timeline', onEvent)
    old.handlers.onEvent('timeline')
    old.handlers.onEnd()
    expect(onEvent).not.toHaveBeenCalled()
    expect(h.timers).toHaveLength(0)
  })
})
