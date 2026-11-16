import { describe, expect, test, vi } from 'vitest'

import type { OAuthToken } from '../../db/types.ts'
import type { GarminDataType } from './process.ts'

import {
  chooseGarminSource,
  type GarminConnections,
  type GarminSourceTarget,
  garminRoutedClient,
  getGarminConnections,
  hasGarminConnection,
  readGarminPersonalKeyEnabled,
} from './source.ts'

const NOW = new Date('2026-11-14T12:00:00Z')
const hoursBefore = (hours: number): Date => new Date(NOW.getTime() - hours * 3_600_000)

const connections = ({
  session = false,
  key = false,
  refused = false,
  refusalCheckedAt = NOW,
  expiresAt = null,
}: {
  session?: boolean
  key?: boolean
  refused?: boolean
  refusalCheckedAt?: Date
  expiresAt?: Date | null
}): GarminConnections => ({
  personal_key: {
    connected: key,
    expires_at: key ? expiresAt : null,
    refusal_checked_at: key && refused ? refusalCheckedAt : null,
    refused: key && refused,
  },
  session,
})

const keyTypes: GarminDataType[] = [
  'dailySummary',
  'heartRate',
  'hrv',
  'bodyBattery',
  'spo2',
  'respiration',
  'intensityMinutes',
  'activities',
]
const sessionOnly: GarminSourceTarget[] = ['stress', 'trainingReadiness', 'activitySession']

describe('chooseGarminSource', () => {
  test.each(keyTypes)('%s comes from the key when one is usable, with or without a session', (type) => {
    expect(chooseGarminSource(type, connections({ key: true }))).toBe('personal_key')
    expect(chooseGarminSource(type, connections({ key: true, session: true }))).toBe('personal_key')
  })

  test('sleep comes from the session when both exist (stage timeline), else from the key', () => {
    expect(chooseGarminSource('sleep', connections({ key: true, session: true }))).toBe('session')
    expect(chooseGarminSource('sleep', connections({ key: true }))).toBe('personal_key')
  })

  test('the activity detail comes from the key whenever it is usable, else from the session', () => {
    expect(chooseGarminSource('activityDetail', connections({ key: true }))).toBe('personal_key')
    expect(chooseGarminSource('activityDetail', connections({ key: true, session: true }))).toBe(
      'personal_key',
    )
    expect(
      chooseGarminSource('activityDetail', connections({ key: true, refused: true, session: true }), NOW),
    ).toBe('session')
    expect(chooseGarminSource('activityDetail', connections({ key: true, refused: true }), NOW)).toBeNull()
    expect(chooseGarminSource('activityDetail', connections({ session: true }))).toBe('session')
    expect(chooseGarminSource('activityDetail', connections({}))).toBeNull()
  })

  test.each(sessionOnly)('%s needs the session and is skipped with a key alone', (target) => {
    expect(chooseGarminSource(target, connections({ key: true, session: true }))).toBe('session')
    expect(chooseGarminSource(target, connections({ key: true }))).toBeNull()
  })

  test.each([...keyTypes, 'sleep' as const])(
    '%s falls back to the session when the key was refused',
    (type) => {
      expect(chooseGarminSource(type, connections({ key: true, refused: true, session: true }), NOW)).toBe(
        'session',
      )
      expect(chooseGarminSource(type, connections({ key: true, refused: true }), NOW)).toBeNull()
    },
  )

  test('a refused key is tried again once a day after the last refusal', () => {
    const refusedAgo = (hours: number) =>
      connections({ key: true, refusalCheckedAt: hoursBefore(hours), refused: true, session: true })

    expect(chooseGarminSource('hrv', refusedAgo(23), NOW)).toBe('session')
    expect(chooseGarminSource('hrv', refusedAgo(24), NOW)).toBe('personal_key')
    expect(chooseGarminSource('trainingReadiness', refusedAgo(24), NOW)).toBe('session')
  })

  test('a key past its expiry date is not used, and is still used on the date itself', () => {
    const expiringOn = (date: string) =>
      connections({ expiresAt: new Date(`${date}T00:00:00Z`), key: true, session: true })

    expect(chooseGarminSource('hrv', expiringOn('2026-11-14'), NOW)).toBe('personal_key')
    expect(chooseGarminSource('hrv', expiringOn('2026-11-13'), NOW)).toBe('session')
    expect(
      chooseGarminSource('hrv', connections({ expiresAt: new Date('2026-11-13T00:00:00Z'), key: true }), NOW),
    ).toBeNull()
  })

  test.each([...keyTypes, 'sleep' as const, ...sessionOnly])('%s uses the session alone', (target) => {
    expect(chooseGarminSource(target, connections({ session: true }))).toBe('session')
  })

  test.each([...keyTypes, 'sleep' as const, ...sessionOnly])(
    '%s has no source without a connection',
    (target) => {
      expect(chooseGarminSource(target, connections({}))).toBeNull()
    },
  )
})

const tokenDeps = (tokens: Record<string, OAuthToken | null>) => ({
  getOAuthToken: vi.fn(async (_user: string, provider: string) => tokens[provider] ?? null),
})

describe('getGarminConnections', () => {
  test('reads both rows', async () => {
    const expiresAt = new Date('2027-01-01T00:00:00Z')
    const deps = tokenDeps({
      garmin: { access_token: '{"oauth1":{}}', provider: 'garmin' },
      garmin_personal: {
        access_token: '',
        expires_at: expiresAt,
        provider: 'garmin_personal',
        refresh_token: 'k',
      },
    })

    expect(await getGarminConnections('alice', deps)).toEqual({
      personal_key: { connected: true, expires_at: expiresAt, refusal_checked_at: null, refused: false },
      session: true,
    })
    expect(deps.getOAuthToken).toHaveBeenCalledWith('alice', 'garmin')
    expect(deps.getOAuthToken).toHaveBeenCalledWith('alice', 'garmin_personal')
  })

  test('an emptied session row and no key row mean nothing is connected', async () => {
    const deps = tokenDeps({ garmin: { access_token: '', provider: 'garmin' } })

    expect(await getGarminConnections('alice', deps)).toEqual({
      personal_key: { connected: false, expires_at: null, refusal_checked_at: null, refused: false },
      session: false,
    })
    expect(await hasGarminConnection('alice', deps)).toBe(false)
  })

  test('a refused key is reported with when it was last checked, and still counts as a connection', async () => {
    const refusedAt = hoursBefore(72)
    const lastChecked = hoursBefore(2)
    const deps = tokenDeps({
      garmin_personal: {
        access_token: '',
        provider: 'garmin_personal',
        refresh_token: 'k',
        refused_at: refusedAt,
        updated_at: lastChecked,
      },
    })

    expect((await getGarminConnections('alice', deps)).personal_key).toMatchObject({
      refusal_checked_at: lastChecked,
      refused: true,
    })
    expect(await hasGarminConnection('alice', deps)).toBe(true)
  })
})

describe('readGarminPersonalKeyEnabled', () => {
  test.each([
    [null, true],
    [true, true],
    [false, false],
  ])('stored %s reads as %s', async (stored, expected) => {
    const centralDb = { getServerSetting: vi.fn().mockResolvedValue(stored) }
    expect(await readGarminPersonalKeyEnabled(centralDb as never)).toBe(expected)
  })
})

describe('garminRoutedClient', () => {
  const fakeClient = (label: string) => ({
    getActivities: vi.fn(async () => [label]),
    getActivityDetail: vi.fn(async () => label),
    getActivityExerciseSets: vi.fn(async () => label),
    getActivityFile: vi.fn(async () => label),
    getHrv: vi.fn(async () => label),
    getSleep: vi.fn(async () => label),
    getStress: vi.fn(async () => label),
  })

  test('routes each data method by the chosen source', async () => {
    const session = fakeClient('session')
    const personal = fakeClient('personal')
    const garmin = garminRoutedClient({
      getConnections: async () => connections({ key: true, session: true }),
      personal: personal as never,
      session: session as never,
    })
    const day = new Date('2026-11-12')

    expect(await garmin.getHrv('alice', day)).toBe('personal')
    expect(await garmin.getSleep('alice', day)).toBe('session')
    expect(await garmin.getActivities('alice', 0, 20)).toEqual(['personal'])
    expect(await garmin.getStress('alice', day)).toBe('session')
    expect(await garmin.getActivityDetail('alice', 1)).toBe('session')
    expect(await garmin.getActivityExerciseSets('alice', 1)).toBe('session')
    expect(await garmin.getActivityFile('alice', 1)).toBe('personal')
    expect(await garmin.sourceFor('alice', 'stress')).toBe('session')
  })

  test('sourceFor is null for a type a key alone cannot serve', async () => {
    const garmin = garminRoutedClient({
      getConnections: async () => connections({ key: true }),
      personal: fakeClient('personal') as never,
      session: fakeClient('session') as never,
    })

    expect(await garmin.sourceFor('alice', 'trainingReadiness')).toBeNull()
    expect(await garmin.sourceFor('alice', 'activitySession')).toBeNull()
    expect(await garmin.sourceFor('alice', 'activityDetail')).toBe('personal_key')
    expect(await garmin.sourceFor('alice', 'sleep')).toBe('personal_key')
  })
})
