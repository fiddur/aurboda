import { describe, expect, test, vi } from 'vitest'

import type { GuardTarget, ProcessGuardDeps } from './process-guards.ts'

import { createProcessReporters, installProcessGuards } from './process-guards.ts'

const makeDeps = (): ProcessGuardDeps & { flush: ReturnType<typeof vi.fn> } => ({
  capture: vi.fn(),
  exit: vi.fn(),
  flush: vi.fn().mockResolvedValue(true),
  log: vi.fn(),
})

/** Collects handlers instead of registering them on the real process. */
const makeTarget = () => {
  const handlers = new Map<string, (arg: unknown) => void>()
  const target: GuardTarget = {
    on: ((event: string, handler: (arg: unknown) => void) => {
      handlers.set(event, handler)
      return process
    }) as GuardTarget['on'],
  }
  return { handlers, target }
}

describe('createProcessReporters', () => {
  test('report logs, captures, and flushes without exiting', async () => {
    const deps = makeDeps()
    const error = new Error('background boom')

    await createProcessReporters(deps).report('⚠️ label:', error)

    expect(deps.log).toHaveBeenCalledWith('⚠️ label:', error)
    expect(deps.capture).toHaveBeenCalledWith(error, undefined)
    expect(deps.flush).toHaveBeenCalledWith(2000)
    expect(deps.exit).not.toHaveBeenCalled()
  })

  test('reportAndExit exits 1 after the flush settles', async () => {
    const deps = makeDeps()
    let releaseFlush: () => void = () => {}
    deps.flush.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseFlush = resolve
      }),
    )

    createProcessReporters(deps).reportAndExit('💥 label:', new Error('fatal'))
    await Promise.resolve()

    // Still draining — exiting here would drop the event we just captured.
    expect(deps.capture).toHaveBeenCalled()
    expect(deps.exit).not.toHaveBeenCalled()

    releaseFlush()
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(1))
  })

  test('exits even when flushing fails', async () => {
    const deps = makeDeps()
    deps.flush.mockRejectedValue(new Error('transport down'))

    createProcessReporters(deps).reportAndExit('💥 label:', new Error('fatal'))

    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(1))
  })
})

describe('installProcessGuards', () => {
  test('an unhandled rejection is reported but survives', async () => {
    const deps = makeDeps()
    const { handlers, target } = makeTarget()
    installProcessGuards(deps, target)

    handlers.get('unhandledRejection')!(new Error('transient sync failure'))
    await vi.waitFor(() => expect(deps.flush).toHaveBeenCalled())

    // The whole point of the asymmetry: a background sync failing must not drop
    // every in-flight request and open SSE stream.
    expect(deps.capture).toHaveBeenCalled()
    expect(deps.exit).not.toHaveBeenCalled()
  })

  test('an uncaught exception exits', async () => {
    const deps = makeDeps()
    const { handlers, target } = makeTarget()
    installProcessGuards(deps, target)

    handlers.get('uncaughtException')!(new Error('undefined state'))

    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(1))
  })

  test('registers exactly the two process events', () => {
    const { handlers, target } = makeTarget()
    installProcessGuards(makeDeps(), target)

    expect([...handlers.keys()].sort()).toEqual(['uncaughtException', 'unhandledRejection'])
  })

  test('tags a fatal exception unhandled, matching what Sentry used to send', async () => {
    // Without this hint the event defaults to `handled: true`, so it is not
    // tagged Unhandled — `error.unhandled` alert rules miss it and release health
    // records errored rather than crashed.
    const deps = makeDeps()
    const { handlers, target } = makeTarget()
    installProcessGuards(deps, target)

    handlers.get('uncaughtException')!(new Error('fatal'))
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalled())

    expect(deps.capture).toHaveBeenCalledWith(expect.any(Error), {
      captureContext: { level: 'fatal' },
      mechanism: { handled: false, type: 'auto.node.onuncaughtexception' },
    })
  })

  test('marks a survived rejection handled so release health is not told it crashed', async () => {
    const deps = makeDeps()
    const { handlers, target } = makeTarget()
    installProcessGuards(deps, target)

    handlers.get('unhandledRejection')!(new Error('transient'))
    await vi.waitFor(() => expect(deps.flush).toHaveBeenCalled())

    expect(deps.capture).toHaveBeenCalledWith(expect.any(Error), {
      mechanism: { handled: true, type: 'auto.node.onunhandledrejection' },
    })
    expect(deps.exit).not.toHaveBeenCalled()
  })
})
