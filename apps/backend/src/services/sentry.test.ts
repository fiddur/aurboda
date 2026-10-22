import type * as SentryNode from '@sentry/node'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { CentralDb } from './central-db.ts'

import { initSentry, Sentry } from './sentry.ts'

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
}))

const makeCentralDb = (dsn: string | null) =>
  ({
    getServerSetting: vi.fn().mockResolvedValue(dsn),
  }) as unknown as CentralDb

describe('initSentry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns false and does not call Sentry.init when DSN is unset', async () => {
    const enabled = await initSentry(makeCentralDb(null))
    expect(enabled).toBe(false)
    expect(Sentry.init).not.toHaveBeenCalled()
  })

  test('returns false on empty-string DSN', async () => {
    const enabled = await initSentry(makeCentralDb(''))
    expect(enabled).toBe(false)
    expect(Sentry.init).not.toHaveBeenCalled()
  })

  test('returns true and initializes Sentry with the configured DSN', async () => {
    const dsn = 'https://abc@o1.ingest.sentry.io/2'
    const enabled = await initSentry(makeCentralDb(dsn))
    expect(enabled).toBe(true)
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn, sendDefaultPii: true, integrations: expect.any(Function) }),
    )
  })

  test('drops the process-handler integrations so crashes are not reported twice', async () => {
    // api.ts installs its own unhandledRejection/uncaughtException handlers that
    // capture and flush. Sentry's own integrations stop *exiting* once another
    // listener exists, but keep capturing — two events per crash.
    //
    // Run against the SDK's real defaults, not a hand-built list: the regression
    // worth catching is an integration being renamed on a @sentry/node bump,
    // which would leave the filter matching nothing and every crash reported
    // twice again. A list built from the same literals as the implementation
    // would stay green through that.
    const actual = await vi.importActual<typeof SentryNode>('@sentry/node')
    const defaults = actual.getDefaultIntegrations({})
    const defaultNames = defaults.map((i) => i.name)
    expect(defaultNames).toContain('OnUncaughtException')
    expect(defaultNames).toContain('OnUnhandledRejection')

    await initSentry(makeCentralDb('https://abc@o1.ingest.sentry.io/2'))

    const filter = vi.mocked(Sentry.init).mock.calls[0]![0]!.integrations
    if (typeof filter !== 'function') throw new Error('expected an integrations filter function')

    const keptNames = filter(defaults).map((i) => i.name)
    expect(keptNames).not.toContain('OnUncaughtException')
    expect(keptNames).not.toContain('OnUnhandledRejection')
    expect(keptNames).toHaveLength(defaults.length - 2)
  })
})
