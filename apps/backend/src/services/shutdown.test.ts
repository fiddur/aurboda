import { describe, expect, test, vi } from 'vitest'

import {
  closeHttpServer,
  createShutdownHandler,
  SHUTDOWN_HARD_TIMEOUT_MS,
  type ShutdownDeps,
} from './shutdown.ts'

const deferred = () => {
  let resolve: () => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

const makeDeps = (overrides: Partial<ShutdownDeps> = {}) => {
  const calls: string[] = []
  const timers: Array<{ fn: () => void; ms: number }> = []
  let clock = 1000
  const deps: ShutdownDeps = {
    closeHttp: vi.fn(async () => {
      calls.push('http')
    }),
    closePools: vi.fn(async () => {
      calls.push('pools')
    }),
    exit: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    now: () => clock,
    startTimer: (fn, ms) => {
      timers.push({ fn, ms })
    },
    stopJobs: vi.fn(async () => {
      calls.push('jobs')
    }),
    stopTimers: vi.fn(() => {
      calls.push('timers')
    }),
    ...overrides,
  }
  return {
    advance: (ms: number) => {
      clock += ms
    },
    calls,
    deps,
    timers,
  }
}

describe('createShutdownHandler', () => {
  test('stops timers, closes HTTP and jobs, then closes pools and exits 0', async () => {
    const { calls, deps } = makeDeps()

    createShutdownHandler(deps)()

    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0))
    expect(calls).toEqual(['timers', 'http', 'jobs', 'pools'])
    expect(deps.log).toHaveBeenCalledWith('Shutting down...')
  })

  test('stops accepting HTTP before stopping jobs, and drains both in parallel', async () => {
    const http = deferred()
    const jobs = deferred()
    const { calls, deps } = makeDeps({
      closeHttp: vi.fn(() => {
        calls.push('http')
        return http.promise
      }),
      stopJobs: vi.fn(() => {
        calls.push('jobs')
        return jobs.promise
      }),
    })

    createShutdownHandler(deps)()
    await Promise.resolve()

    expect(calls).toEqual(['timers', 'http', 'jobs'])

    jobs.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(deps.closePools).not.toHaveBeenCalled()

    http.resolve()
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0))
    expect(calls).toEqual(['timers', 'http', 'jobs', 'pools'])
  })

  test('logs the elapsed time when done', async () => {
    const http = deferred()
    const { advance, deps } = makeDeps({ closeHttp: () => http.promise })

    createShutdownHandler(deps)()
    advance(1234)
    http.resolve()

    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalled())
    expect(deps.log).toHaveBeenCalledWith('Shutdown complete in 1234 ms')
  })

  test('a failing step still runs the rest and exits 1', async () => {
    const error = new Error('boss down')
    const { calls, deps } = makeDeps({ stopJobs: vi.fn().mockRejectedValue(error) })

    createShutdownHandler(deps)()

    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(1))
    expect(calls).toEqual(['timers', 'http', 'pools'])
    expect(deps.logError).toHaveBeenCalledWith(expect.stringContaining('jobs'), error)
  })

  test('a throwing timer stop does not prevent the drain', async () => {
    const { calls, deps } = makeDeps({
      stopTimers: () => {
        throw new Error('timer boom')
      },
    })

    createShutdownHandler(deps)()

    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(1))
    expect(calls).toEqual(['http', 'jobs', 'pools'])
  })

  test('arms a hard timeout that forces exit 1 when the drain hangs', async () => {
    const { deps, timers } = makeDeps({ closeHttp: () => new Promise(() => {}) })

    createShutdownHandler(deps)()

    expect(timers).toHaveLength(1)
    expect(timers[0].ms).toBe(SHUTDOWN_HARD_TIMEOUT_MS)
    expect(deps.exit).not.toHaveBeenCalled()

    timers[0].fn()

    expect(deps.exit).toHaveBeenCalledWith(1)
    expect(deps.logError).toHaveBeenCalled()
    expect(deps.closePools).not.toHaveBeenCalled()
  })

  test('honours a custom hard timeout', () => {
    const { deps, timers } = makeDeps({ hardTimeoutMs: 500 })

    createShutdownHandler(deps)()

    expect(timers[0].ms).toBe(500)
  })

  test('a second signal during the drain is ignored', async () => {
    const http = deferred()
    const { deps, timers } = makeDeps({ closeHttp: vi.fn(() => http.promise) })
    const onSignal = createShutdownHandler(deps)

    onSignal()
    onSignal()

    expect(deps.closeHttp).toHaveBeenCalledTimes(1)
    expect(deps.log).toHaveBeenCalledTimes(1)
    expect(timers).toHaveLength(1)

    http.resolve()
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledTimes(1))
  })
})

const makeServer = () => {
  let closeCallback: (err?: Error) => void = () => {}
  return {
    finishClose: (err?: Error) => closeCallback(err),
    server: {
      close: vi.fn((cb: (err?: Error) => void) => {
        closeCallback = cb
      }),
      closeAllConnections: vi.fn(),
      closeIdleConnections: vi.fn(),
    },
  }
}

describe('closeHttpServer', () => {
  test('stops listening, drops idle sockets, and forces the rest after the drain', async () => {
    const { finishClose, server } = makeServer()
    const timers: Array<{ fn: () => void; ms: number }> = []

    const closed = closeHttpServer(server, 3000, (fn, ms) => timers.push({ fn, ms }))

    expect(server.close).toHaveBeenCalled()
    expect(server.closeIdleConnections).toHaveBeenCalled()
    expect(server.closeAllConnections).not.toHaveBeenCalled()
    expect(timers.map((t) => t.ms)).toEqual([3000])

    timers[0].fn()
    expect(server.closeAllConnections).toHaveBeenCalled()

    finishClose()
    await expect(closed).resolves.toBeUndefined()
  })

  test('rejects when the server fails to close', async () => {
    const { finishClose, server } = makeServer()
    const error = new Error('ERR_SERVER_NOT_RUNNING')

    const closed = closeHttpServer(server, 3000, () => {})
    finishClose(error)

    await expect(closed).rejects.toBe(error)
  })
})
