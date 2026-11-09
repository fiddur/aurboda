import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { UsageRow } from './usage-recorder.ts'

import { getTestDbClient, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  ALTER_USER_ACCOUNTS_PLAN_COLUMNS,
  ALTER_USER_ACCOUNTS_PROFILE_COLUMNS,
  createUserAccountsApi,
  CREATE_USER_ACCOUNTS_TABLE,
} from './central-user-accounts.ts'
import {
  createUserUsageApi,
  CREATE_USER_USAGE_DAILY_INDEXES,
  CREATE_USER_USAGE_DAILY_TABLE,
} from './central-user-usage.ts'

const CONTAINER_TIMEOUT = 120_000

const row = (overrides: Partial<UsageRow>): UsageRow => ({
  channel: 'web',
  count: 1,
  day: '2026-11-06',
  items: 1,
  kind: 'read',
  last_at: new Date('2026-11-06T10:00:00Z'),
  username: 'alice',
  ...overrides,
})

beforeAll(async () => {
  await startTestDb()
  const client = getTestDbClient()
  await client.query(CREATE_USER_ACCOUNTS_TABLE)
  // Twice, as every start runs them: the columns are added once and kept.
  const alters = [...ALTER_USER_ACCOUNTS_PLAN_COLUMNS, ...ALTER_USER_ACCOUNTS_PROFILE_COLUMNS]
  for (const stmt of [...alters, ...alters]) {
    await client.query(stmt)
  }
  await client.query(CREATE_USER_USAGE_DAILY_TABLE)
  for (const stmt of CREATE_USER_USAGE_DAILY_INDEXES) await client.query(stmt)
}, CONTAINER_TIMEOUT)

afterAll(async () => {
  await stopTestDb()
})

beforeEach(async () => {
  await getTestDbClient().query('TRUNCATE TABLE user_accounts, user_usage_daily')
})

describe('central user_accounts', () => {
  const api = () => createUserAccountsApi(async () => getTestDbClient())

  test('ensureUserAccount inserts once and keeps the first row', async () => {
    const a = api()
    const signup = new Date('2026-11-06T10:00:00Z')

    expect(await a.ensureUserAccount('alice', { createdAt: signup, preExisting: false })).toBe(true)
    expect(await a.ensureUserAccount('alice', { createdAt: null, preExisting: true })).toBe(false)

    const account = await a.getUserAccount('alice')
    expect(account).toMatchObject({ created_at: signup, pre_existing: false, username: 'alice' })
    expect(account?.inserted_at).toBeInstanceOf(Date)
  })

  test('backfillUserAccounts adds pre-existing rows only for names without one', async () => {
    const a = api()
    await a.ensureUserAccount('alice', { createdAt: new Date('2026-11-06T10:00:00Z'), preExisting: false })

    expect(await a.backfillUserAccounts(['alice', 'bob', 'carol'])).toBe(2)
    expect(await a.backfillUserAccounts(['alice', 'bob', 'carol'])).toBe(0)
    expect(await a.backfillUserAccounts([])).toBe(0)

    const accounts = await a.listUserAccounts()
    expect(
      accounts.map(({ created_at, pre_existing, username }) => [username, pre_existing, created_at]),
    ).toEqual([
      ['alice', false, new Date('2026-11-06T10:00:00Z')],
      ['bob', true, null],
      ['carol', true, null],
    ])
  })

  test('backfillUserAccounts stores the given starting plan on the rows it inserts only', async () => {
    const a = api()
    const trialEnd = new Date('2027-02-04T10:00:00Z')
    await a.ensureUserAccount('alice', { createdAt: null, plan: 'exempt', preExisting: false })

    expect(await a.backfillUserAccounts(['alice', 'bob'], { plan: 'trial', trialEndsAt: trialEnd })).toBe(1)

    expect(await a.getUserAccount('alice')).toMatchObject({ plan: 'exempt', trial_ends_at: null })
    expect(await a.getUserAccount('bob')).toMatchObject({
      created_at: null,
      plan: 'trial',
      pre_existing: true,
      trial_ends_at: trialEnd,
    })
  })

  test('ensureUserAccount stores a starting plan; without one the plan is null', async () => {
    const a = api()
    const trialEnd = new Date('2027-02-04T10:00:00Z')
    await a.ensureUserAccount('alice', {
      createdAt: null,
      plan: 'trial',
      preExisting: false,
      trialEndsAt: trialEnd,
    })
    await a.ensureUserAccount('bob', { createdAt: null, preExisting: false })

    expect(await a.getUserAccount('alice')).toMatchObject({
      paid_until: null,
      plan: 'trial',
      plan_note: null,
      trial_ends_at: trialEnd,
    })
    expect(await a.getUserAccount('bob')).toMatchObject({ plan: null, trial_ends_at: null })
  })

  test('markUnplannedAccountsExempt marks only the accounts without a plan', async () => {
    const a = api()
    await a.ensureUserAccount('alice', { createdAt: null, plan: 'trial', preExisting: false })
    await a.backfillUserAccounts(['bob', 'carol'])

    expect(await a.markUnplannedAccountsExempt()).toBe(2)
    expect(await a.markUnplannedAccountsExempt()).toBe(0)
    expect((await a.listUserAccounts()).map(({ plan, username }) => [username, plan])).toEqual([
      ['alice', 'trial'],
      ['bob', 'exempt'],
      ['carol', 'exempt'],
    ])
  })

  test('updateUserPlan writes the given fields, clears nulls and leaves the rest', async () => {
    const a = api()
    const trialEnd = new Date('2027-02-04T10:00:00Z')
    const paidUntil = new Date('2027-06-01T00:00:00Z')
    await a.ensureUserAccount('alice', {
      createdAt: null,
      plan: 'trial',
      preExisting: false,
      trialEndsAt: trialEnd,
    })

    const paid = await a.updateUserPlan('alice', {
      paid_until: paidUntil,
      plan: 'paid',
      plan_note: 'Patreon',
    })
    expect(paid).toMatchObject({
      paid_until: paidUntil,
      plan: 'paid',
      plan_note: 'Patreon',
      trial_ends_at: trialEnd,
    })

    const cleared = await a.updateUserPlan('alice', { plan_note: null, trial_ends_at: null })
    expect(cleared).toMatchObject({
      paid_until: paidUntil,
      plan: 'paid',
      plan_note: null,
      trial_ends_at: null,
    })
    expect(await a.getUserAccount('alice')).toEqual(cleared)
  })

  test('updateUserPlan inserts a pre-existing row for an account without one', async () => {
    const a = api()
    const account = await a.updateUserPlan('dave', { plan: 'exempt' })

    expect(account).toMatchObject({ created_at: null, plan: 'exempt', pre_existing: true, username: 'dave' })
    expect(await a.updateUserPlan('dave', {})).toMatchObject({ plan: 'exempt', username: 'dave' })
  })

  test('setUserEmail sets and clears the email and keeps the rest of the row', async () => {
    const a = api()
    await a.ensureUserAccount('alice', { createdAt: null, plan: 'trial', preExisting: false })
    expect(await a.getUserAccount('alice')).toMatchObject({ email: null })

    const set = await a.setUserEmail('alice', 'Alice@Example.com')
    expect(set).toMatchObject({ email: 'Alice@Example.com', plan: 'trial', pre_existing: false })
    expect(await a.getUserAccount('alice')).toEqual(set)
    expect((await a.listUserAccounts()).map(({ email, username }) => [username, email])).toEqual([
      ['alice', 'Alice@Example.com'],
    ])

    expect(await a.setUserEmail('alice', null)).toMatchObject({ email: null, plan: 'trial' })
    expect(await a.getUserAccount('alice')).toMatchObject({ email: null })
  })

  test('setUserEmail resolves to null and inserts nothing for an account without a row', async () => {
    const a = api()

    expect(await a.setUserEmail('dave', 'dave@example.com')).toBeNull()
    expect(await a.getUserAccount('dave')).toBeNull()
    expect(await a.listUserAccounts()).toEqual([])
  })

  test('deleteUserAccount removes the row', async () => {
    const a = api()
    await a.ensureUserAccount('alice', { createdAt: null, preExisting: true })

    expect(await a.deleteUserAccount('alice')).toBe(true)
    expect(await a.deleteUserAccount('alice')).toBe(false)
    expect(await a.getUserAccount('alice')).toBeNull()
  })
})

describe('central user_usage_daily', () => {
  const api = () => createUserUsageApi(async () => getTestDbClient())

  test('upsertUsageRows accumulates across flushes and keeps the latest last_at', async () => {
    const a = api()
    await a.upsertUsageRows([
      row({ count: 2, items: 2, last_at: new Date('2026-11-06T12:00:00Z') }),
      row({ channel: 'garmin', count: 1, items: 300, kind: 'ingest' }),
    ])
    await a.upsertUsageRows([
      row({ count: 3, items: 3, last_at: new Date('2026-11-06T11:00:00Z') }),
      row({
        channel: 'garmin',
        count: 2,
        items: 50,
        kind: 'ingest',
        last_at: new Date('2026-11-06T13:00:00Z'),
      }),
    ])
    await a.upsertUsageRows([])

    expect(await a.getUsageDaily({ since: new Date('2026-11-01T00:00:00Z') })).toEqual([
      row({
        channel: 'garmin',
        count: 3,
        items: 350,
        kind: 'ingest',
        last_at: new Date('2026-11-06T13:00:00Z'),
      }),
      row({ count: 5, items: 5, last_at: new Date('2026-11-06T12:00:00Z') }),
    ])
  })

  test('getUsageDaily filters by user and from the UTC date of since', async () => {
    const a = api()
    await a.upsertUsageRows([
      row({ day: '2026-11-04' }),
      row({ day: '2026-11-05' }),
      row({ day: '2026-11-05', username: 'bob' }),
    ])

    const rows = await a.getUsageDaily({ since: new Date('2026-11-05T23:00:00Z'), username: 'alice' })
    expect(rows.map((r) => [r.username, r.day])).toEqual([['alice', '2026-11-05']])
  })

  test('getUsageSummary totals per user, kind and channel', async () => {
    const a = api()
    await a.upsertUsageRows([
      row({ count: 4, day: '2026-11-01', items: 4, last_at: new Date('2026-11-01T09:00:00Z') }),
      row({ count: 2, day: '2026-11-03', items: 2, last_at: new Date('2026-11-03T08:00:00Z') }),
      row({ channel: 'mcp', count: 1, day: '2026-11-03', kind: 'write' }),
      row({ channel: 'oura', count: 3, day: '2026-11-02', items: 90, kind: 'ingest', username: 'bob' }),
      row({ count: 9, day: '2026-10-01', items: 9 }),
    ])

    expect(await a.getUsageSummary(new Date('2026-11-01T00:00:00Z'))).toEqual([
      {
        active_days: 2,
        channel: 'web',
        count: 6,
        items: 6,
        kind: 'read',
        last_at: new Date('2026-11-03T08:00:00Z'),
        username: 'alice',
      },
      {
        active_days: 1,
        channel: 'mcp',
        count: 1,
        items: 1,
        kind: 'write',
        last_at: new Date('2026-11-06T10:00:00Z'),
        username: 'alice',
      },
      {
        active_days: 1,
        channel: 'oura',
        count: 3,
        items: 90,
        kind: 'ingest',
        last_at: new Date('2026-11-06T10:00:00Z'),
        username: 'bob',
      },
    ])
  })

  test('pruneUsageBefore deletes the days before the given UTC date', async () => {
    const a = api()
    await a.upsertUsageRows([
      row({ day: '2025-10-01' }),
      row({ day: '2025-10-02' }),
      row({ day: '2026-11-06' }),
    ])

    expect(await a.pruneUsageBefore(new Date('2025-10-02T03:17:00Z'))).toBe(1)
    const days = (await a.getUsageDaily({ since: new Date('2000-01-01T00:00:00Z') })).map((r) => r.day)
    expect(days).toEqual(['2025-10-02', '2026-11-06'])
  })
})
