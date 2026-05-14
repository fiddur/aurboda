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
    expect(Sentry.init).toHaveBeenCalledWith({ dsn, sendDefaultPii: true })
  })
})
