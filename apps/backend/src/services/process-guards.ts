/**
 * Reporting for failures outside a request.
 *
 * Express 5 forwards rejections from async route handlers to the error
 * middleware, so these do not cover routes. They cover work started without an
 * owning request: the ~40 `void thing()` calls, queue workers, and webhook
 * managers, where Node's own reporting names neither the subsystem nor the
 * deploy.
 *
 * The two handlers deliberately differ, matching what a DSN-configured deploy
 * already does:
 *
 *   - `uncaughtException` exits. Node documents the state afterwards as
 *     undefined, and Sentry's own integration already called
 *     `logAndExitProcess` here, so exiting changes nothing. `entrypoint.sh`
 *     watches the backend PID, so the container restarts.
 *   - `unhandledRejection` does not. Sentry's `onUnhandledRejection` integration
 *     defaults to `mode: 'warn'`, which captures, warns, and keeps running — so
 *     a DSN-configured deploy is already non-fatal here, and making it fatal
 *     would let one transient error inside any of those `void` calls drop every
 *     in-flight request and open timeline SSE stream for every user. A
 *     background sync failing is not worth that. (For a DSN-less deploy this
 *     *is* a change: it had no listener, so Node's default `throw` crashed it.)
 *
 * The gap that leaves — a subsystem dead behind an `/api/version` that still
 * answers 200 — is at least visible in Sentry rather than silent.
 *
 * Capturing explicitly, rather than leaving it to Sentry's own
 * `onUncaughtException` / `onUnhandledRejection` integrations, keeps the event
 * queued *before* `flush` starts draining, so it cannot be lost to the exit.
 * Those two integrations are disabled in `initSentry` to avoid double-reporting
 * the same crash — registering these listeners stops them exiting, but not
 * capturing.
 *
 * Dependencies are injected so the exit/non-exit asymmetry is assertable without
 * touching the real process.
 */

/** How long to let Sentry drain before exiting. */
const FLUSH_TIMEOUT_MS = 2000

/**
 * Subset of Sentry's capture hint we need. Without one, `captureException`
 * defaults to the `generic` mechanism with `handled: true`, so the event would
 * not be tagged **Unhandled**: alert rules keyed on `error.unhandled` would miss
 * it and release health would mark the session errored rather than crashed —
 * exactly the signal a process-death guard exists to send.
 */
export interface CaptureHint {
  captureContext?: { level: 'fatal' }
  mechanism?: { handled: boolean; type: string }
}

/**
 * Matches what Sentry's own `onUncaughtException` integration sent before we
 * disabled it, so grouping and `error.unhandled` rules behave as they did.
 */
export const fatalHint: CaptureHint = {
  captureContext: { level: 'fatal' },
  mechanism: { handled: false, type: 'auto.node.onuncaughtexception' },
}

/**
 * Unhandled by the application, but this guard recovers and the process keeps
 * serving — so deliberately not `handled: false`, which would mark the
 * release-health session crashed when nothing crashed.
 */
const recoveredRejectionHint: CaptureHint = {
  mechanism: { handled: true, type: 'auto.node.onunhandledrejection' },
}

export interface ProcessGuardDeps {
  capture: (error: unknown, hint?: CaptureHint) => void
  exit: (code: number) => void
  flush: (timeoutMs: number) => Promise<unknown>
  log: (label: string, error: unknown) => void
}

export interface ProcessReporters {
  /** Log, capture, and drain the queue. Resolves once flushing settles. */
  report: (label: string, error: unknown, hint?: CaptureHint) => Promise<void>
  /** As `report`, then exit non-zero so the container restarts. */
  reportAndExit: (label: string, error: unknown, hint?: CaptureHint) => void
}

export const createProcessReporters = (deps: ProcessGuardDeps): ProcessReporters => {
  const report = async (label: string, error: unknown, hint?: CaptureHint): Promise<void> => {
    deps.log(label, error)
    deps.capture(error, hint)
    await deps.flush(FLUSH_TIMEOUT_MS).catch(() => {})
  }

  return {
    report,
    reportAndExit: (label, error, hint = fatalHint) => {
      void report(label, error, hint).finally(() => deps.exit(1))
    },
  }
}

/** Minimal shape of what we register on — `process`, or a stub in tests. */
export type GuardTarget = Pick<NodeJS.Process, 'on'>

/**
 * Register the process-level handlers. Returns the reporters so callers can use
 * the same pair for failures they catch themselves (e.g. startup).
 */
export const installProcessGuards = (
  deps: ProcessGuardDeps,
  target: GuardTarget = process,
): ProcessReporters => {
  const reporters = createProcessReporters(deps)

  target.on('unhandledRejection', (reason) => {
    void reporters.report('⚠️ Unhandled promise rejection (background work):', reason, recoveredRejectionHint)
  })
  target.on('uncaughtException', (error) => {
    reporters.reportAndExit('💥 Uncaught exception (background work):', error)
  })

  return reporters
}
