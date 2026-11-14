import { describe, expect, test, vi } from 'vitest'

import type { NotificationInsert } from '../../db/index.ts'
import type { OAuthToken } from '../../db/types.ts'

import { createNotifier, READ_RETENTION_DAYS } from '../../services/notifications.ts'
import { type GarminKeyState, garminKeyReminder, remindGarminKey } from './key-reminder.ts'

const NOW = new Date('2026-11-13T18:30:00Z')
const REFUSED_AT = new Date('2026-11-10T08:00:00Z')

const expiry = (days: number): Date => new Date(Date.UTC(2026, 10, 13 + days))
const date = (days: number): string => expiry(days).toISOString().slice(0, 10)

const key = (days: number | null, refused = false): GarminKeyState => ({
  expires_at: days === null ? null : expiry(days),
  refused_at: refused ? REFUSED_AT : null,
})

const expiringBody = (days: number) =>
  `Create a new Personal API key in Garmin Connect and paste it here before ${date(days)}.`
const expiredBody =
  'The data it served has stopped syncing. Create a new Personal API key in Garmin Connect and paste it here.'
const refusedBody =
  'It was probably deleted or replaced in Garmin Connect. Create a new key and paste it here.'

describe('garminKeyReminder', () => {
  test.each([
    ['no key', null],
    ['no expiry and not refused', key(null)],
    ['15 days left', key(15)],
  ])('%s: no reminder', (_name, state) => {
    expect(garminKeyReminder(state, NOW)).toBeNull()
  })

  test.each([
    ['14 days', key(14), '14d', 'Your Garmin key expires in 14 days', 'expiring', 14],
    ['4 days', key(4), '14d', 'Your Garmin key expires in 4 days', 'expiring', 4],
    ['3 days', key(3), '3d', 'Your Garmin key expires in 3 days', 'expiring', 3],
    ['1 day', key(1), '3d', 'Your Garmin key expires tomorrow', 'expiring', 1],
    ['0 days', key(0), '3d', 'Your Garmin key expires today', 'expiring', 0],
    ['-1 day', key(-1), 'expired', 'Your Garmin key has expired', 'expired', -1],
    ['refused, past date', key(-2, true), 'expired', 'Your Garmin key has expired', 'expired', -2],
  ])('%s', (_name, state, prefix, title, reason, daysLeft) => {
    const days = daysLeft as number
    expect(garminKeyReminder(state, NOW)).toEqual({
      body: reason === 'expired' ? expiredBody : expiringBody(days),
      data: { days_left: days, expires_at: date(days), reason },
      dedupe_key: `garmin_key_expiring:${prefix}:${date(days)}`,
      link: '/data-sources/garmin',
      title,
      type: 'garmin_key_expiring',
    })
  })

  test('refused with a future date', () => {
    expect(garminKeyReminder(key(30, true), NOW)).toEqual({
      body: refusedBody,
      data: { days_left: 30, expires_at: date(30), reason: 'refused' },
      dedupe_key: 'garmin_key_expiring:refused:2026-11-10T08:00:00.000Z',
      link: '/data-sources/garmin',
      title: 'Garmin refused your Personal API key',
      type: 'garmin_key_expiring',
    })
  })

  test('refused with no expiry date', () => {
    expect(garminKeyReminder(key(null, true), NOW)).toMatchObject({
      data: { days_left: null, expires_at: null, reason: 'refused' },
      dedupe_key: 'garmin_key_expiring:refused:2026-11-10T08:00:00.000Z',
    })
  })

  test('counts UTC calendar days, whatever the time of day', () => {
    expect(garminKeyReminder(key(1), new Date('2026-11-13T23:59:59Z'))?.title).toBe(
      'Your Garmin key expires tomorrow',
    )
    expect(garminKeyReminder(key(1), new Date('2026-11-14T00:00:00Z'))?.title).toBe(
      'Your Garmin key expires today',
    )
  })
})

describe('remindGarminKey', () => {
  const row = (overrides: Partial<OAuthToken> = {}): OAuthToken => ({
    access_token: 'fake-jwt',
    expires_at: expiry(2),
    provider: 'garmin_personal',
    refresh_token: 'fake-api-key-for-tests',
    ...overrides,
  })

  const setup = (stored: OAuthToken | null | Error) => {
    const getOAuthToken = vi.fn(async () => {
      if (stored instanceof Error) throw stored
      return stored
    })
    const raiseBestEffort = vi.fn(async () => {})
    const logError = vi.fn()
    const remind = remindGarminKey({ getOAuthToken, logError, now: () => NOW, raiseBestEffort })
    return { getOAuthToken, logError, raiseBestEffort, remind }
  }

  test('raises the due reminder for the user, with no key material', async () => {
    const { getOAuthToken, raiseBestEffort, remind } = setup(row())

    await remind('alice')

    expect(getOAuthToken).toHaveBeenCalledWith('alice', 'garmin_personal')
    expect(raiseBestEffort).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ dedupe_key: `garmin_key_expiring:3d:${date(2)}` }),
    )
    const raised = JSON.stringify(raiseBestEffort.mock.calls)
    expect(raised).not.toContain('fake-api-key-for-tests')
    expect(raised).not.toContain('fake-jwt')
  })

  test('does nothing without a key, or with a row whose key was cleared', async () => {
    for (const stored of [null, row({ refresh_token: undefined }), row({ refresh_token: '' })]) {
      const { raiseBestEffort, remind } = setup(stored)
      await remind('alice')
      expect(raiseBestEffort).not.toHaveBeenCalled()
    }
  })

  test('does nothing when no reminder is due', async () => {
    const { raiseBestEffort, remind } = setup(row({ expires_at: expiry(60) }))
    await remind('alice')
    expect(raiseBestEffort).not.toHaveBeenCalled()
  })

  test('swallows and logs a failing read', async () => {
    const { logError, raiseBestEffort, remind } = setup(new Error('db down'))

    await expect(remind('alice')).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledOnce()
    expect(raiseBestEffort).not.toHaveBeenCalled()
  })
})

describe('a dead key left connected', () => {
  test('is reminded again once the read reminder is pruned, about every 90 days', async () => {
    let now = NOW
    const rows: { dedupe_key: string | null; created_at: Date; read_at: Date | null }[] = []
    const notifier = createNotifier({
      getPreference: async () => null,
      insert: async (_user: string, input: NotificationInsert) => {
        if (input.dedupe_key && rows.some((r) => r.dedupe_key === input.dedupe_key)) return null
        const row = { created_at: now, dedupe_key: input.dedupe_key ?? null, read_at: null }
        rows.push(row)
        return row as never
      },
      now: () => now,
      prune: async (_user: string, readBefore: Date, anyBefore: Date) => {
        const kept = rows.filter(
          (r) => !((r.read_at && r.created_at < readBefore) || r.created_at < anyBefore),
        )
        const pruned = rows.length - kept.length
        rows.splice(0, rows.length, ...kept)
        return pruned
      },
      revise: async () => null,
      reviseOpen: async () => [],
    })
    const remind = remindGarminKey({
      getOAuthToken: async () => ({
        access_token: '',
        expires_at: expiry(-1),
        provider: 'garmin_personal',
        refresh_token: 'fake-api-key-for-tests',
      }),
      now: () => now,
      raiseBestEffort: notifier.raiseBestEffort,
    })
    const expiredReminders = () => rows.filter((r) => r.dedupe_key?.includes(':expired:'))
    const daysLater = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000)

    await remind('alice')
    await remind('alice')
    expect(expiredReminders()).toHaveLength(1)
    expiredReminders()[0]!.read_at = NOW

    now = daysLater(READ_RETENTION_DAYS - 1)
    await notifier.raise('alice', { title: 'Something else', type: 'garmin_key_expiring' })
    await remind('alice')
    expect(expiredReminders()).toHaveLength(1)

    now = daysLater(READ_RETENTION_DAYS + 1)
    await notifier.raise('alice', { title: 'Something else', type: 'garmin_key_expiring' })
    expect(expiredReminders()).toHaveLength(0)
    await remind('alice')
    expect(expiredReminders()).toHaveLength(1)
    expect(expiredReminders()[0]!.created_at).toEqual(now)
  })
})
