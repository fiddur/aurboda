/**
 * SIGTERM/SIGINT handling for the backend.
 *
 * The bounds nest: pg-boss gets `JOB_STOP_TIMEOUT_MS`, the whole shutdown
 * `SHUTDOWN_HARD_TIMEOUT_MS`, `entrypoint.sh` waits a little longer than that for
 * node before SIGKILLing it, and Docker's stop timeout (30 s, see
 * docs/docker.md) is the outermost. Each inner bound must stay below the next,
 * or the outer one kills the process mid-drain.
 */

export const SHUTDOWN_HARD_TIMEOUT_MS = 25_000
export const JOB_STOP_TIMEOUT_MS = 10_000
export const SHUTDOWN_DRAIN_MS = 3000

export type StartTimer = (onTimeout: () => void, ms: number) => void

export const startUnrefTimer: StartTimer = (onTimeout, ms) => {
  setTimeout(onTimeout, ms).unref()
}

export interface ShutdownDeps {
  stopTimers: () => void
  /** Must stop accepting connections synchronously, before it first awaits. */
  closeHttp: () => Promise<void>
  stopJobs: () => Promise<void>
  closePools: () => Promise<void>
  exit: (code: number) => void
  log: (message: string) => void
  logError: (message: string, error?: unknown) => void
  now: () => number
  startTimer: StartTimer
  hardTimeoutMs?: number
}

const runSteps = async (deps: ShutdownDeps): Promise<boolean> => {
  const step = async (label: string, fn: () => Promise<void>): Promise<boolean> => {
    try {
      await fn()
      return true
    } catch (error) {
      deps.logError(`💥 Shutdown step failed (${label}):`, error)
      return false
    }
  }

  let timersOk = true
  try {
    deps.stopTimers()
  } catch (error) {
    deps.logError('💥 Shutdown step failed (timers):', error)
    timersOk = false
  }
  // No await before this line, so the listener closes in the signal's own tick.
  // Pools go last: in-flight requests and running jobs still query through them.
  const [httpOk, jobsOk] = await Promise.all([step('http', deps.closeHttp), step('jobs', deps.stopJobs)])
  const poolsOk = await step('pools', deps.closePools)
  return timersOk && httpOk && jobsOk && poolsOk
}

/**
 * Returns the signal handler. Guarded against re-entry: a second Ctrl-C during
 * the drain would otherwise call `server.close()` on an already-closing server,
 * get `ERR_SERVER_NOT_RUNNING`, and abort the drain with a failure exit code.
 */
export const createShutdownHandler = (deps: ShutdownDeps): (() => void) => {
  let shuttingDown = false
  return () => {
    if (shuttingDown) return
    shuttingDown = true
    const startedAt = deps.now()
    const hardTimeoutMs = deps.hardTimeoutMs ?? SHUTDOWN_HARD_TIMEOUT_MS
    deps.log('Shutting down...')
    deps.startTimer(() => {
      deps.logError(`💥 Shutdown still running after ${hardTimeoutMs} ms, forcing exit`)
      deps.exit(1)
    }, hardTimeoutMs)
    void runSteps(deps).then((ok) => {
      deps.log(`Shutdown complete in ${deps.now() - startedAt} ms`)
      deps.exit(ok ? 0 : 1)
    })
  }
}

export interface ClosableServer {
  close: (callback: (err?: Error) => void) => unknown
  closeAllConnections: () => void
  closeIdleConnections: () => void
}

/**
 * `server.close` waits for every connection to end. Idle keep-alive sockets are
 * dropped straight away, and in-flight requests get `drainMs` before the rest
 * are forced: `/timeline/stream` is an indefinite text/event-stream that never
 * ends on its own, while forcing everything at once would ECONNRESET a sync POST
 * mid-response.
 */
export const closeHttpServer = (
  server: ClosableServer,
  drainMs: number = SHUTDOWN_DRAIN_MS,
  startTimer: StartTimer = startUnrefTimer,
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err)
      else resolve()
    })
    server.closeIdleConnections()
    startTimer(() => server.closeAllConnections(), drainMs)
  })
