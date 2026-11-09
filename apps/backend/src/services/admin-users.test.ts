import { describe, expect, test } from 'vitest'

import type { UserAccount } from './central-user-accounts.ts'
import type { UsageSummaryRow } from './central-user-usage.ts'
import type { UsageRow } from './usage-recorder.ts'

import { BILLING_DISABLED, type BillingSettings } from './account-plan.ts'
import { type AdminUsersDeps, createAdminUsers, SIZE_CACHE_MS, windowStart } from './admin-users.ts'

const NOW = new Date('2026-11-06T12:00:00Z')

const daily = (overrides: Partial<UsageRow>): UsageRow => ({
  channel: 'web',
  count: 1,
  day: '2026-11-06',
  items: 0,
  kind: 'read',
  last_at: new Date('2026-11-06T10:00:00Z'),
  username: 'alice',
  ...overrides,
})

const summary = (overrides: Partial<UsageSummaryRow>): UsageSummaryRow => ({
  active_days: 1,
  channel: 'web',
  count: 1,
  items: 0,
  kind: 'read',
  last_at: new Date('2026-11-06T10:00:00Z'),
  username: 'alice',
  ...overrides,
})

interface Fixture {
  billing?: BillingSettings
  users?: string[]
  accounts?: UserAccount[]
  admins?: string[]
  summaryRows?: UsageSummaryRow[]
  dailyRows?: UsageRow[]
  sizes?: Map<string, number>
  now?: () => Date
}

const setup = (fixture: Fixture = {}) => {
  const calls = { databaseSizes: 0, dailySince: [] as string[], summarySince: [] as string[] }
  const admins = fixture.admins ?? []
  const accounts = fixture.accounts ?? []
  const dailyRows = fixture.dailyRows ?? []
  const deps: AdminUsersDeps = {
    centralDb: {
      getAdmins: async () => admins,
      getUsageDaily: async ({ username, since }) => {
        calls.dailySince.push(since.toISOString())
        const day = since.toISOString().slice(0, 10)
        return dailyRows.filter((r) => r.day >= day && (username === undefined || r.username === username))
      },
      getUsageSummary: async (since) => {
        calls.summarySince.push(since.toISOString())
        return fixture.summaryRows ?? []
      },
      getUserAccount: async (username) => accounts.find((a) => a.username === username) ?? null,
      isAdmin: async (username) => admins.includes(username),
      listUserAccounts: async () => accounts,
    },
    billingSettings: async () => fixture.billing ?? BILLING_DISABLED,
    databaseSizes: async () => {
      calls.databaseSizes += 1
      return fixture.sizes ?? new Map()
    },
    listUsers: async () => fixture.users ?? ['alice'],
    now: fixture.now ?? (() => NOW),
    tableSizes: async () => [
      { bytes: 2048, table: 'time_series' },
      { bytes: 1024, table: 'locations' },
    ],
  }
  return { calls, service: createAdminUsers(deps) }
}

describe('windowStart', () => {
  test('starts at UTC midnight so the window spans the given calendar days, today included', () => {
    expect(windowStart(NOW, 1).toISOString()).toBe('2026-11-06T00:00:00.000Z')
    expect(windowStart(NOW, 7).toISOString()).toBe('2026-10-31T00:00:00.000Z')
    expect(windowStart(NOW, 30).toISOString()).toBe('2026-10-08T00:00:00.000Z')
  })
})

describe('listUsersOverview', () => {
  test('lists every user with a database, even one without account row, usage or size', async () => {
    const { service } = setup({ users: ['bob', 'alice'] })
    const users = await service.listUsersOverview()

    expect(users.map((u) => u.username)).toEqual(['alice', 'bob'])
    expect(users[1]).toEqual({
      created_at: null,
      email: null,
      ends_at: null,
      paid_until: null,
      plan: null,
      plan_note: null,
      read_only_at: null,
      state: 'active',
      trial_ends_at: null,
      ingest: { items_30d: 0, last_at: null, per_day_30d: 0, per_day_7d: 0, sources: [] },
      is_admin: false,
      last_api_at: null,
      last_ui_at: null,
      pre_existing: false,
      storage_bytes: null,
      use: {
        android: { active_days_30d: 0, last_at: null, reads_30d: 0, writes_30d: 0 },
        api: { active_days_30d: 0, last_at: null, reads_30d: 0, writes_30d: 0 },
        mcp: { active_days_30d: 0, last_at: null, reads_30d: 0, writes_30d: 0 },
        web: { active_days_30d: 0, last_at: null, reads_30d: 0, writes_30d: 0 },
      },
      username: 'bob',
    })
  })

  test('joins account rows, the admin flag and database sizes', async () => {
    const signup = new Date('2026-10-01T08:00:00Z')
    const { service } = setup({
      accounts: [
        {
          created_at: signup,
          email: 'alice@example.com',
          inserted_at: signup,
          paid_until: null,
          plan: null,
          plan_note: null,
          trial_ends_at: null,
          pre_existing: false,
          username: 'alice',
        },
        {
          created_at: null,
          email: null,
          inserted_at: signup,
          paid_until: null,
          plan: null,
          plan_note: null,
          trial_ends_at: null,
          pre_existing: true,
          username: 'bob',
        },
      ],
      admins: ['bob'],
      sizes: new Map([
        ['alice', 1234],
        ['bob', 5678],
      ]),
      users: ['alice', 'bob'],
    })
    const [alice, bob] = await service.listUsersOverview()

    expect(alice).toMatchObject({
      created_at: signup.toISOString(),
      email: 'alice@example.com',
      is_admin: false,
      pre_existing: false,
      storage_bytes: 1234,
    })
    expect(bob).toMatchObject({
      created_at: null,
      email: null,
      is_admin: true,
      pre_existing: true,
      storage_bytes: 5678,
    })
  })

  test("each user's plan and state, admins never restricted", async () => {
    const signup = new Date('2026-01-01T08:00:00Z')
    const expired = new Date('2026-10-01T00:00:00Z')
    const { service } = setup({
      accounts: [
        {
          created_at: signup,
          email: null,
          inserted_at: signup,
          paid_until: null,
          plan: 'trial',
          plan_note: 'patreon',
          pre_existing: false,
          trial_ends_at: expired,
          username: 'alice',
        },
        {
          created_at: signup,
          email: null,
          inserted_at: signup,
          paid_until: null,
          plan: 'trial',
          plan_note: null,
          pre_existing: false,
          trial_ends_at: expired,
          username: 'bob',
        },
      ],
      admins: ['bob'],
      billing: { ...BILLING_DISABLED, enabled: true, grace_days: 14 },
      users: ['alice', 'bob'],
    })
    const [alice, bob] = await service.listUsersOverview()

    expect(alice).toMatchObject({
      ends_at: expired.toISOString(),
      plan: 'trial',
      plan_note: 'patreon',
      read_only_at: '2026-10-15T00:00:00.000Z',
      state: 'read_only',
      trial_ends_at: expired.toISOString(),
    })
    expect(bob).toMatchObject({ plan: 'trial', read_only_at: null, state: 'active' })
  })

  test('ingest per day divides events over the 7 and 30 day windows', async () => {
    const { service } = setup({
      dailyRows: [
        daily({ channel: 'oura', count: 14, day: '2026-11-06', items: 100, kind: 'ingest' }),
        daily({ channel: 'health_connect', count: 7, day: '2026-10-31', items: 50, kind: 'ingest' }),
        // Outside the 7-day window, inside the 30-day one.
        daily({ channel: 'garmin', count: 9, day: '2026-10-30', items: 5, kind: 'ingest' }),
        daily({ channel: 'web', count: 99, day: '2026-11-06', kind: 'read' }),
      ],
      summaryRows: [
        summary({ channel: 'oura', kind: 'ingest', last_at: new Date('2026-11-06T09:00:00Z') }),
        summary({ channel: 'garmin', kind: 'ingest', last_at: new Date('2026-10-30T09:00:00Z') }),
      ],
    })
    const [alice] = await service.listUsersOverview()

    expect(alice.ingest).toEqual({
      items_30d: 155,
      last_at: '2026-11-06T09:00:00.000Z',
      per_day_30d: 1,
      per_day_7d: 3,
      sources: ['garmin', 'health_connect', 'oura'],
    })
  })

  test('per-channel use: reads, writes and active days over 30 days, last use over the retention', async () => {
    const { service } = setup({
      dailyRows: [
        daily({ channel: 'web', count: 5, day: '2026-11-06', kind: 'read' }),
        daily({ channel: 'web', count: 2, day: '2026-11-06', kind: 'write' }),
        daily({ channel: 'web', count: 3, day: '2026-11-01', kind: 'read' }),
        daily({ channel: 'mcp', count: 4, day: '2026-11-02', kind: 'write' }),
      ],
      summaryRows: [
        summary({ channel: 'web', kind: 'read', last_at: new Date('2026-11-06T10:00:00Z') }),
        summary({ channel: 'web', kind: 'write', last_at: new Date('2026-11-06T11:00:00Z') }),
        summary({ channel: 'mcp', kind: 'write', last_at: new Date('2026-11-02T08:00:00Z') }),
        // Outside the 30-day window: last use still shows.
        summary({ channel: 'api', kind: 'read', last_at: new Date('2026-08-01T08:00:00Z') }),
        summary({ channel: 'android', kind: 'read', last_at: new Date('2026-11-05T08:00:00Z') }),
      ],
    })
    const [alice] = await service.listUsersOverview()

    expect(alice.use.web).toEqual({
      active_days_30d: 2,
      last_at: '2026-11-06T11:00:00.000Z',
      reads_30d: 8,
      writes_30d: 2,
    })
    expect(alice.use.mcp).toEqual({
      active_days_30d: 1,
      last_at: '2026-11-02T08:00:00.000Z',
      reads_30d: 0,
      writes_30d: 4,
    })
    expect(alice.use.api).toEqual({
      active_days_30d: 0,
      last_at: '2026-08-01T08:00:00.000Z',
      reads_30d: 0,
      writes_30d: 0,
    })
    expect(alice.last_ui_at).toBe('2026-11-06T11:00:00.000Z')
    expect(alice.last_api_at).toBe('2026-11-02T08:00:00.000Z')
  })

  test('last API use is the latest of the mcp and api channels', async () => {
    const { service } = setup({
      summaryRows: [
        summary({ channel: 'mcp', kind: 'read', last_at: new Date('2026-11-01T08:00:00Z') }),
        summary({ channel: 'api', kind: 'write', last_at: new Date('2026-11-03T08:00:00Z') }),
        summary({ channel: 'web', kind: 'read', last_at: new Date('2026-11-05T08:00:00Z') }),
      ],
    })
    const [alice] = await service.listUsersOverview()
    expect(alice.last_api_at).toBe('2026-11-03T08:00:00.000Z')
  })

  test('reads usage summaries over the retention and daily rows over 30 days', async () => {
    const { calls, service } = setup()
    await service.listUsersOverview()
    expect(calls.dailySince).toEqual(['2026-10-08T00:00:00.000Z'])
    expect(calls.summarySince).toEqual([windowStart(NOW, 400).toISOString()])
  })

  test('caches database sizes for five minutes', async () => {
    let now = NOW
    const { calls, service } = setup({ now: () => now })

    await service.listUsersOverview()
    now = new Date(NOW.getTime() + SIZE_CACHE_MS - 1)
    await service.listUsersOverview()
    await service.getUserUsage('alice')
    expect(calls.databaseSizes).toBe(1)

    now = new Date(NOW.getTime() + SIZE_CACHE_MS)
    await service.listUsersOverview()
    expect(calls.databaseSizes).toBe(2)
  })
})

describe('getUserUsage', () => {
  test('returns null for a user without a database', async () => {
    const { service } = setup({ users: ['alice'] })
    expect(await service.getUserUsage('mallory')).toBeNull()
  })

  test('returns account facts, daily rows from the window and the largest tables', async () => {
    const signup = new Date('2026-10-01T08:00:00Z')
    const { calls, service } = setup({
      accounts: [
        {
          created_at: signup,
          email: 'alice@example.com',
          inserted_at: signup,
          paid_until: null,
          plan: null,
          plan_note: null,
          trial_ends_at: null,
          pre_existing: false,
          username: 'alice',
        },
      ],
      admins: ['alice'],
      dailyRows: [
        daily({ channel: 'oura', count: 3, day: '2026-11-05', items: 30, kind: 'ingest' }),
        daily({ channel: 'web', count: 2, day: '2026-11-06', kind: 'read' }),
        daily({ channel: 'web', count: 2, day: '2026-11-06', kind: 'read', username: 'bob' }),
      ],
      sizes: new Map([['alice', 4096]]),
      users: ['alice', 'bob'],
    })
    const usage = await service.getUserUsage('alice', 7)

    expect(calls.dailySince).toEqual(['2026-10-31T00:00:00.000Z'])
    expect(usage).toEqual({
      created_at: signup.toISOString(),
      ends_at: null,
      paid_until: null,
      plan: null,
      plan_note: null,
      read_only_at: null,
      state: 'active',
      trial_ends_at: null,
      daily: [
        { channel: 'oura', count: 3, day: '2026-11-05', items: 30, kind: 'ingest' },
        { channel: 'web', count: 2, day: '2026-11-06', items: 0, kind: 'read' },
      ],
      email: 'alice@example.com',
      is_admin: true,
      largest_tables: [
        { bytes: 2048, table: 'time_series' },
        { bytes: 1024, table: 'locations' },
      ],
      pre_existing: false,
      since: '2026-10-31',
      storage_bytes: 4096,
      username: 'alice',
    })
  })

  test('defaults to 90 days', async () => {
    const { service } = setup()
    const usage = await service.getUserUsage('alice')
    expect(usage?.since).toBe('2026-08-09')
  })
})
