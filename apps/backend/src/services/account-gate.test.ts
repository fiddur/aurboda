import { isAllowedWhenReadOnly } from '@aurboda/api-spec'
import { describe, expect, test, vi } from 'vitest'

import type { ServerSettings } from './central-db.ts'
import type { UserAccount } from './central-user-accounts.ts'
import type { SyncProvider } from './queries/types.ts'

import {
  createAccountGate,
  GATE_CACHE_MS,
  gateSyncProvider,
  READ_ONLY_MESSAGE,
  safeRefusal,
} from './account-gate.ts'

const NOW = new Date('2026-11-06T12:00:00Z')
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000)

const account = (username: string, trialEndsAt: Date): UserAccount => ({
  created_at: day(-200),
  inserted_at: day(-200),
  paid_until: null,
  plan: 'trial',
  plan_note: null,
  pre_existing: false,
  trial_ends_at: trialEndsAt,
  username,
})

const setup = (settings: Partial<ServerSettings> = { billing_enabled: true }) => {
  let now = NOW
  const accounts = new Map([
    ['expired', account('expired', day(-100))],
    ['fresh', account('fresh', day(30))],
  ])
  const values: Partial<ServerSettings> = { ...settings }
  const centralDb = {
    getServerSetting: async <K extends keyof ServerSettings>(key: K) =>
      (values[key] ?? null) as ServerSettings[K] | null,
    getUserAccount: vi.fn(async (username: string) => accounts.get(username) ?? null),
    isAdmin: vi.fn(async (username: string) => username === 'root'),
  }
  const gate = createAccountGate({ centralDb, now: () => now })
  return {
    accounts,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms)
    },
    centralDb,
    gate,
    values,
  }
}

describe('createAccountGate', () => {
  test('only an account expired past the grace period is read-only', async () => {
    const { gate } = setup()
    expect(await gate.isReadOnly('expired')).toBe(true)
    expect(await gate.isReadOnly('fresh')).toBe(false)
    expect(await gate.isReadOnly('unknown')).toBe(false)
  })

  test('with billing off nobody is read-only and no account is read', async () => {
    const { centralDb, gate } = setup({})
    expect(await gate.isReadOnly('expired')).toBe(false)
    expect(centralDb.getUserAccount).not.toHaveBeenCalled()
  })

  test('the refusal carries the message and the payment link', async () => {
    const { gate } = setup({ billing_enabled: true, payment_url: 'https://patreon.example/aurboda' })
    expect(await gate.refusal('expired')).toEqual({
      error: READ_ONLY_MESSAGE,
      payment_url: 'https://patreon.example/aurboda',
    })
    expect(await gate.refusal('fresh')).toBeNull()
  })

  test('caches statuses for the TTL', async () => {
    const { advance, centralDb, gate } = setup()
    await gate.isReadOnly('expired')
    advance(GATE_CACHE_MS - 1)
    await gate.isReadOnly('expired')
    expect(centralDb.getUserAccount).toHaveBeenCalledTimes(1)

    advance(1)
    await gate.isReadOnly('expired')
    expect(centralDb.getUserAccount).toHaveBeenCalledTimes(2)
  })

  test("invalidating a user drops only that user's status", async () => {
    const { accounts, gate } = setup()
    expect(await gate.isReadOnly('expired')).toBe(true)
    expect(await gate.isReadOnly('fresh')).toBe(false)

    accounts.set('expired', account('expired', day(30)))
    accounts.set('fresh', account('fresh', day(-100)))
    gate.invalidate('expired')

    expect(await gate.isReadOnly('expired')).toBe(false)
    expect(await gate.isReadOnly('fresh')).toBe(false)
  })

  test('invalidating everything also re-reads the billing settings', async () => {
    const { gate, values } = setup()
    expect(await gate.isReadOnly('expired')).toBe(true)

    values.billing_enabled = false
    gate.invalidate()

    expect(await gate.isReadOnly('expired')).toBe(false)
  })

  test('a failed lookup is not cached', async () => {
    const { centralDb, gate } = setup()
    centralDb.getUserAccount.mockRejectedValueOnce(new Error('db down'))
    await expect(gate.isReadOnly('expired')).rejects.toThrow('db down')
    expect(await gate.isReadOnly('expired')).toBe(true)
  })

  test('safeRefusal fails open', async () => {
    const { centralDb, gate } = setup()
    centralDb.getUserAccount.mockRejectedValueOnce(new Error('db down'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await safeRefusal(gate, 'expired')).toBeNull()
    error.mockRestore()
  })

  test('admins are never read-only', async () => {
    const { accounts, gate } = setup()
    accounts.set('root', account('root', day(-100)))
    expect(await gate.isReadOnly('root')).toBe(false)
  })
})

describe('isAllowedWhenReadOnly', () => {
  test.each([
    ['GET', '/activities'],
    ['HEAD', '/activities'],
    ['OPTIONS', '/activities'],
    ['GET', '/account/plan'],
    ['POST', '/export/dump-link'],
    ['DELETE', '/account'],
    ['POST', '/webauthn/register/options'],
    ['POST', '/webauthn/register/verify'],
    ['PATCH', '/webauthn/credentials/abc'],
    ['DELETE', '/webauthn/credentials/abc'],
    ['POST', '/autoshare-rules/preview'],
    ['POST', '/deduction-rules/preview'],
    ['POST', '/feed/activities/0b6c1f0e-3f7e-4a43-9a51-3c1d7d1f2a10/preview'],
    ['POST', '/feed/activities/{id}/preview'],
    ['POST', '/feed/exercises/preview'],
  ])('allows %s %s', (method, path) => {
    expect(isAllowedWhenReadOnly(method, path)).toBe(true)
  })

  test.each([
    ['POST', '/activities'],
    ['PUT', '/user/settings'],
    ['PATCH', '/user/settings'],
    ['DELETE', '/activities/abc'],
    ['POST', '/sync/health-connect'],
    ['POST', '/account'],
    ['POST', '/exporter'],
    ['DELETE', '/account/plan'],
    ['POST', '/autoshare-rules'],
    ['PUT', '/autoshare-rules/preview'],
    ['POST', '/feed/activities/abc/share'],
    ['POST', '/feed/activities/abc/def/preview'],
    ['POST', '/feed/abc/preview'],
  ])('refuses %s %s', (method, path) => {
    expect(isAllowedWhenReadOnly(method, path)).toBe(false)
  })
})

describe('gateSyncProvider', () => {
  const fakeSync = (): SyncProvider => ({
    syncCalendarsIfNeeded: vi.fn(async () => {}),
    syncGarminIfNeeded: vi.fn(async () => {}),
    syncGravlIfNeeded: vi.fn(async () => {}),
    syncLastFmIfNeeded: vi.fn(async () => {}),
    syncOuraIfNeeded: vi.fn(async () => {}),
    syncRescueTimeIfNeeded: vi.fn(async () => {}),
  })

  const callAll = async (sync: SyncProvider, user: string) => {
    await sync.syncCalendarsIfNeeded(user)
    await sync.syncGarminIfNeeded(user, 'sleep')
    await sync.syncGravlIfNeeded(user)
    await sync.syncLastFmIfNeeded(user)
    await sync.syncOuraIfNeeded(user, 'tags')
    await sync.syncRescueTimeIfNeeded(user)
  }

  test('skips every pull for a read-only user', async () => {
    const inner = fakeSync()
    await callAll(
      gateSyncProvider(inner, async () => true),
      'expired',
    )
    for (const fn of Object.values(inner)) expect(fn).not.toHaveBeenCalled()
  })

  test('passes every pull through, with its arguments, for anyone else', async () => {
    const inner = fakeSync()
    await callAll(
      gateSyncProvider(inner, async () => false),
      'alice',
    )
    for (const fn of Object.values(inner)) expect(fn).toHaveBeenCalledTimes(1)
    expect(inner.syncGarminIfNeeded).toHaveBeenCalledWith('alice', 'sleep')
    expect(inner.syncOuraIfNeeded).toHaveBeenCalledWith('alice', 'tags')
  })
})
