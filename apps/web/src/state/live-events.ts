import { API_URL } from '../config'
import { type LiveEventKind, parseLiveEvents } from './api/live-sse'
import { auth } from './auth'

export type { LiveEventKind }

export interface LiveStreamHandlers {
  onOpen: () => void
  onEvent: (kind: LiveEventKind) => void
  /** The stream could not be opened, or dropped. Not called after its own close. */
  onEnd: () => void
}

export interface LiveEventsDeps {
  open: (token: string, handlers: LiveStreamHandlers) => () => void
  getToken: () => string | undefined
  onTokenChange: (listener: () => void) => void
  isVisible: () => boolean
  onVisibilityChange: (listener: () => void) => void
  setTimer: (callback: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

export interface LiveEvents {
  subscribe: (
    kind: LiveEventKind,
    onEvent: () => void,
    onFallbackChange?: (down: boolean) => void,
  ) => () => void
}

const RETRY_DELAYS_MS = [5_000, 15_000, 60_000]

export const retryDelayMs = (attempt: number): number =>
  RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]

/**
 * Only a visible tab holds the stream: over HTTP/1.1 a browser allows six connections per
 * origin, and a stream held by every background tab would starve ordinary requests.
 */
export const shouldStreamBeOpen = (state: {
  subscribers: number
  token: string | undefined
  visible: boolean
}): boolean => state.subscribers > 0 && Boolean(state.token) && state.visible

interface Subscriber {
  kind: LiveEventKind
  onEvent: () => void
  onFallbackChange?: (down: boolean) => void
}

export const createLiveEvents = (deps: LiveEventsDeps): LiveEvents => {
  const subscribers = new Set<Subscriber>()
  let stream: { token: string; close: () => void } | null = null
  let retry: { handle: unknown } | null = null
  let attempt = 0
  let down = false

  const setDown = (value: boolean) => {
    if (down === value) return
    down = value
    for (const subscriber of [...subscribers]) subscriber.onFallbackChange?.(value)
  }

  const dispatch = (kind?: LiveEventKind) => {
    for (const subscriber of [...subscribers]) {
      if (kind === undefined || subscriber.kind === kind) subscriber.onEvent()
    }
  }

  const stop = () => {
    stream?.close()
    stream = null
    if (retry) deps.clearTimer(retry.handle)
    retry = null
    attempt = 0
    setDown(false)
  }

  const connect = (token: string) => {
    const current = { close: () => {}, token }
    stream = current
    current.close = deps.open(token, {
      onEnd: () => {
        if (stream !== current) return
        stream = null
        setDown(true)
        const handle = deps.setTimer(() => {
          retry = null
          reconcile()
        }, retryDelayMs(attempt++))
        retry = { handle }
      },
      onEvent: (kind) => {
        if (stream === current) dispatch(kind)
      },
      onOpen: () => {
        if (stream !== current) return
        attempt = 0
        const recovered = down
        setDown(false)
        if (recovered) dispatch()
      },
    })
  }

  const reconcile = () => {
    const token = deps.getToken()
    if (!shouldStreamBeOpen({ subscribers: subscribers.size, token, visible: deps.isVisible() })) {
      stop()
      return
    }
    if (stream && stream.token !== token) stop()
    if (stream || retry || !token) return
    connect(token)
  }

  deps.onTokenChange(reconcile)
  deps.onVisibilityChange(() => {
    // Events sent while hidden were missed: everyone refetches once.
    if (deps.isVisible() && deps.getToken()) dispatch()
    reconcile()
  })

  const subscribe: LiveEvents['subscribe'] = (kind, onEvent, onFallbackChange) => {
    const subscriber: Subscriber = { kind, onEvent, onFallbackChange }
    subscribers.add(subscriber)
    if (down) onFallbackChange?.(true)
    reconcile()
    return () => {
      subscribers.delete(subscriber)
      reconcile()
    }
  }

  return { subscribe }
}

const openStream = (token: string, handlers: LiveStreamHandlers): (() => void) => {
  const controller = new AbortController()
  void (async () => {
    try {
      // `fetch`, not `EventSource`, so the token rides in a header rather than the URL.
      const response = await fetch(`${API_URL}/events/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      if (!response.ok || !response.body) return handlers.onEnd()
      handlers.onOpen()
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const { events, rest } = parseLiveEvents(buffer + decoder.decode(value, { stream: true }))
        buffer = rest
        for (const kind of events) handlers.onEvent(kind)
      }
      handlers.onEnd()
    } catch {
      if (!controller.signal.aborted) handlers.onEnd()
    }
  })()
  return () => controller.abort()
}

let shared: LiveEvents | null = null

/** One `/events/stream` per tab, shared by every subscriber; `onFallbackChange(true)` means poll meanwhile. */
export const subscribeLiveEvents: LiveEvents['subscribe'] = (kind, onEvent, onFallbackChange) => {
  shared ??= createLiveEvents({
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    getToken: () => auth.value.token,
    isVisible: () => document.visibilityState === 'visible',
    onTokenChange: (listener) => {
      let token = auth.value.token
      auth.subscribe((value) => {
        if (value.token === token) return
        token = value.token
        listener()
      })
    },
    onVisibilityChange: (listener) => document.addEventListener('visibilitychange', listener),
    open: openStream,
    setTimer: (callback, ms) => setTimeout(callback, ms),
  })
  return shared.subscribe(kind, onEvent, onFallbackChange)
}
