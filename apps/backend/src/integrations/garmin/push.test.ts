import { describe, expect, test, vi } from 'vitest'

import type { RawRecord, SyncState } from '../../db/types.ts'
import type { GarminGrantProbe } from './oauth-client.ts'
import type { GarminDataType } from './process.ts'

import {
  createSerialQueue,
  garminPushExternalId,
  garminPushRecordType,
  garminPushToken,
  garminPushUrl,
  type GarminPushDeps,
  isGarminPushToken,
  receiveGarminPush,
} from './push.ts'

const SESSION_SECRET = 'fake-session-secret'
const TOKEN = garminPushToken(SESSION_SECRET)
const CLIENT_ID = 'fake-client-id'
const NOW = new Date('2026-11-17T10:00:00Z')
const GARMIN_USER = 'garmin-user-1'
const OLD_TOKEN = 'fake-user-access-token'

const makeDeps = (
  options: {
    users?: Record<string, string>
    readOnly?: string[]
    disabled?: GarminDataType[]
    probe?: GarminGrantProbe
    clientId?: string | null
  } = {},
) => {
  const users = options.users ?? { [GARMIN_USER]: 'alice' }
  const deps = {
    auditError: vi.fn(async () => {}),
    auditInfo: vi.fn(async () => {}),
    auditWarn: vi.fn(async () => {}),
    forgetGrant: vi.fn(async () => {}),
    getClientId: vi.fn(async () => (options.clientId === undefined ? CLIENT_ID : options.clientId)),
    getDisabledDataTypes: vi.fn(async () => options.disabled ?? []),
    getUsernameByGarminUserId: vi.fn(async (id: string) => users[id] ?? null),
    insertRawRecords: vi.fn(async (_user: string, _records: RawRecord[]) => {}),
    insertTimeSeries: vi.fn(async () => {}),
    isReadOnly: vi.fn(async (user: string) => (options.readOnly ?? []).includes(user)),
    logWarn: vi.fn(),
    now: () => NOW,
    probeGrant: vi.fn(async () => options.probe ?? { garminUserId: GARMIN_USER, status: 'alive' as const }),
    processGarminData: vi.fn(async (_user: string, _dataType: GarminDataType, _data: unknown) => 1),
    pushToken: TOKEN,
    updateGrantScopes: vi.fn(async () => true),
    upsertSyncState: vi.fn(async (_user: string, _state: SyncState) => {}),
  }
  return deps satisfies GarminPushDeps
}

type Deps = ReturnType<typeof makeDeps>

const receive = (deps: Deps, body: unknown, overrides: { token?: string; clientIdHeader?: string } = {}) =>
  receiveGarminPush(deps, {
    body,
    clientIdHeader: overrides.clientIdHeader,
    token: overrides.token ?? TOKEN,
  })

const storedRecords = (deps: Deps) => deps.insertRawRecords.mock.calls.flatMap((call) => call[1])

/** Every argument any audit or log mock was called with. */
const everythingSaid = (deps: Deps) =>
  JSON.stringify([
    deps.auditInfo.mock.calls,
    deps.auditWarn.mock.calls,
    deps.auditError.mock.calls,
    deps.logWarn.mock.calls,
  ])

const daily = (overrides: Record<string, unknown> = {}) => ({
  calendarDate: '2026-11-16',
  startTimeInSeconds: 1795305600,
  steps: 1000,
  summaryId: 'sd-1',
  userAccessToken: OLD_TOKEN,
  userId: GARMIN_USER,
  ...overrides,
})

describe('push URL and token', () => {
  test('derives a stable token from the session secret and puts it in the URL', () => {
    expect(garminPushToken(SESSION_SECRET)).toBe(TOKEN)
    expect(garminPushToken('another-secret')).not.toBe(TOKEN)
    expect(garminPushUrl('https://api.example.test/api', SESSION_SECRET)).toBe(
      `https://api.example.test/api/webhooks/garmin/${TOKEN}`,
    )
  })

  test('compares tokens of any length without throwing', () => {
    expect(isGarminPushToken(TOKEN, TOKEN)).toBe(true)
    expect(isGarminPushToken('short', TOKEN)).toBe(false)
    expect(isGarminPushToken(`${TOKEN.slice(0, -1)}x`, TOKEN)).toBe(false)
  })
})

describe('record naming', () => {
  test.each([
    ['dailies', 'garmin_push_dailies'],
    ['stressDetails', 'garmin_push_stress_details'],
    ['allDayRespiration', 'garmin_push_all_day_respiration'],
    ['moveIQActivities', 'garmin_push_move_iq_activities'],
    ['pulseox', 'garmin_push_pulseox'],
  ])('%s is stored as %s', (type, recordType) => {
    expect(garminPushRecordType(type)).toBe(recordType)
  })

  test('external id falls back from summaryId to activityId to a time', () => {
    expect(garminPushExternalId('dailies', { activityId: 7, summaryId: 's' })).toBe('s')
    expect(garminPushExternalId('activities', { activityId: 7 })).toBe('7')
    expect(garminPushExternalId('epochs', { startTimeInSeconds: 100 })).toBe('epochs-100')
    expect(garminPushExternalId('bodyComps', { measurementTimeInSeconds: 200 })).toBe('bodyComps-200')
    expect(garminPushExternalId('mct', { calendarDate: '2026-11-16' })).toBe('mct-2026-11-16')
    expect(garminPushExternalId('mct', {})).toBeUndefined()
  })
})

describe('gate', () => {
  test('a wrong token is a 404 and stores nothing', async () => {
    const deps = makeDeps()
    expect(await receive(deps, { dailies: [daily()] }, { token: 'wrong' })).toEqual({ status: 404 })
    expect(deps.insertRawRecords).not.toHaveBeenCalled()
  })

  test('no configured client id is a 404', async () => {
    const deps = makeDeps({ clientId: null })
    expect(await receive(deps, { dailies: [daily()] })).toEqual({ status: 404 })
    expect(deps.insertRawRecords).not.toHaveBeenCalled()
  })

  test('a different garmin-client-id header is a 403', async () => {
    const deps = makeDeps()
    expect(await receive(deps, { dailies: [daily()] }, { clientIdHeader: 'other-client' })).toEqual({
      status: 403,
    })
    expect(deps.insertRawRecords).not.toHaveBeenCalled()
  })

  test('the matching header and no header are both accepted', async () => {
    expect((await receive(makeDeps(), { dailies: [daily()] }, { clientIdHeader: CLIENT_ID })).status).toBe(
      200,
    )
    expect((await receive(makeDeps(), { dailies: [daily()] })).status).toBe(200)
  })

  test.each([null, 'text', [1, 2], 42])(
    'a body that is not an object (%j) is a 200 with nothing to do',
    async (body) => {
      const deps = makeDeps()
      expect(await receive(deps, body)).toEqual({ status: 200 })
    },
  )
})

describe('storing', () => {
  test('keeps each item as a raw record without userAccessToken and userId', async () => {
    const deps = makeDeps()
    await receive(deps, { dailies: [daily()] })
    expect(deps.insertRawRecords).toHaveBeenCalledWith('alice', [
      {
        data: { calendarDate: '2026-11-16', startTimeInSeconds: 1795305600, steps: 1000, summaryId: 'sd-1' },
        external_id: 'sd-1',
        record_type: 'garmin_push_dailies',
        recorded_at: new Date(1795305600 * 1000),
        source: 'garmin',
      },
    ])
    expect(JSON.stringify(deps.insertRawRecords.mock.calls)).not.toContain(OLD_TOKEN)
    expect(JSON.stringify(deps.insertRawRecords.mock.calls)).not.toContain(GARMIN_USER)
  })

  test('recorded_at falls back to noon of calendarDate, then now', async () => {
    const deps = makeDeps()
    await receive(deps, {
      mct: [
        { calendarDate: '2026-11-16', summaryId: 'm-1', userId: GARMIN_USER },
        { summaryId: 'm-2', userId: GARMIN_USER },
      ],
    })
    expect(storedRecords(deps).map((r) => (r as { recorded_at: Date }).recorded_at)).toEqual([
      new Date('2026-11-16T12:00:00Z'),
      NOW,
    ])
  })

  test('keeps types without a processor and unknown types raw', async () => {
    const deps = makeDeps()
    const result = await receive(deps, {
      activities: [{ activityId: 99, summaryId: 'a-1', userId: GARMIN_USER }],
      somethingNew: [{ summaryId: 'n-1', userId: GARMIN_USER }],
    })
    expect(result.status).toBe(200)
    expect(storedRecords(deps).map((r) => (r as { record_type: string }).record_type)).toEqual([
      'garmin_push_activities',
      'garmin_push_something_new',
    ])
  })

  test('drops items for an unknown Garmin user, logging only a count', async () => {
    const deps = makeDeps()
    const result = await receive(deps, { dailies: [daily({ userId: 'garmin-user-unknown' })] })
    expect(result).toEqual({ status: 200 })
    expect(deps.insertRawRecords).not.toHaveBeenCalled()
    expect(deps.logWarn).toHaveBeenCalledWith(expect.stringContaining('1 item(s)'))
    expect(everythingSaid(deps)).not.toContain('garmin-user-unknown')
  })

  test('drops items without a userId, without an id, and of a malformed type key', async () => {
    const deps = makeDeps()
    await receive(deps, {
      'bad key!': [{ summaryId: 'x', userId: GARMIN_USER }],
      dailies: [{ steps: 1 }, { userId: GARMIN_USER }, 'x'],
    })
    expect(storedRecords(deps)).toEqual([])
    expect(deps.logWarn).toHaveBeenCalledWith(expect.stringContaining('4 item(s)'))
  })

  test('stores nothing for a read-only account', async () => {
    const deps = makeDeps({ readOnly: ['alice'] })
    expect(await receive(deps, { dailies: [daily()] })).toEqual({ status: 200 })
    expect(deps.insertRawRecords).not.toHaveBeenCalled()
  })

  test('still acts on a deregistration for a read-only account', async () => {
    const deps = makeDeps({ readOnly: ['alice'] })
    const result = await receive(deps, { dailies: [daily()], deregistrations: [{ userId: GARMIN_USER }] })
    expect(result.status).toBe(200)
    expect(deps.insertRawRecords).not.toHaveBeenCalled()
    await result.process?.()
    expect(deps.probeGrant).toHaveBeenCalledWith('alice')
    expect(deps.processGarminData).not.toHaveBeenCalled()
  })

  test('skips a type whose every feed is disabled, with no raw record', async () => {
    const deps = makeDeps({ disabled: ['stress', 'bodyBattery'] })
    const result = await receive(deps, {
      stressDetails: [{ calendarDate: '2026-11-16', summaryId: 's-1', userId: GARMIN_USER }],
    })
    expect(storedRecords(deps)).toEqual([])
    expect(result.process).toBeUndefined()
    expect(deps.auditInfo).toHaveBeenCalledWith('alice', 'sync', 'Garmin: data received', {
      counts: {},
      skipped_disabled: { stressDetails: 1 },
    })
  })

  test('keeps a type when only some of its feeds are disabled, and processes only the enabled ones', async () => {
    const deps = makeDeps({ disabled: ['heartRate'] })
    const result = await receive(deps, {
      dailies: [daily({ timeOffsetHeartRateSamples: { '0': 60 } })],
    })
    expect(storedRecords(deps)).toHaveLength(1)
    await result.process!()
    expect(deps.processGarminData.mock.calls.map((call) => call[1])).toEqual(['dailySummary'])
  })

  test('a failure to store is a 500 so Garmin retries, and nothing is processed', async () => {
    const deps = makeDeps()
    deps.insertRawRecords.mockRejectedValueOnce(new Error('db down'))
    expect(await receive(deps, { dailies: [daily()] })).toEqual({ status: 500 })
  })

  test('one audit entry per user with counts per type only', async () => {
    const deps = makeDeps()
    await receive(deps, {
      dailies: [daily(), daily({ summaryId: 'sd-2' })],
      epochs: [daily({ summaryId: 'e-1' })],
    })
    expect(deps.auditInfo).toHaveBeenCalledTimes(1)
    expect(deps.auditInfo).toHaveBeenCalledWith('alice', 'sync', 'Garmin: data received', {
      counts: { dailies: 2, epochs: 1 },
    })
  })

  test('groups by Garmin user', async () => {
    const deps = makeDeps({ users: { [GARMIN_USER]: 'alice', 'garmin-user-2': 'bob' } })
    await receive(deps, { dailies: [daily(), daily({ summaryId: 'sd-2', userId: 'garmin-user-2' })] })
    expect(deps.insertRawRecords.mock.calls.map((call) => call[0])).toEqual(['alice', 'bob'])
    expect(deps.getUsernameByGarminUserId).toHaveBeenCalledTimes(2)
  })
})

describe('processing', () => {
  test('happens only when the caller runs it, after the answer', async () => {
    const deps = makeDeps()
    const result = await receive(deps, { dailies: [daily()] })
    expect(result.status).toBe(200)
    expect(deps.processGarminData).not.toHaveBeenCalled()
    await result.process!()
    expect(deps.processGarminData).toHaveBeenCalledWith('alice', 'dailySummary', expect.any(Object))
  })

  test('writes direct points and a garmin_push sync state per type', async () => {
    const deps = makeDeps()
    const result = await receive(deps, {
      epochs: [daily({ summaryId: 'e-1' })],
      pulseox: [
        {
          startTimeInSeconds: 1795305600,
          summaryId: 'p-1',
          timeOffsetSpo2Values: { '0': 97 },
          userId: GARMIN_USER,
        },
      ],
    })
    await result.process!()
    expect(deps.insertTimeSeries).toHaveBeenCalledWith('alice', [
      expect.objectContaining({ metric: 'spo2', value: 97 }),
    ])
    expect(deps.upsertSyncState.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({
        data_type: 'epochs',
        last_sync_time: NOW,
        provider: 'garmin_push',
        status: 'idle',
      }),
      expect.objectContaining({
        data_type: 'pulseox',
        last_sync_time: NOW,
        provider: 'garmin_push',
        status: 'idle',
      }),
    ])
  })

  test('a processing error is audited for the user and does not reject', async () => {
    const deps = makeDeps()
    deps.processGarminData.mockRejectedValueOnce(new Error('boom'))
    const result = await receive(deps, { dailies: [daily()] })
    await expect(result.process!()).resolves.toBeUndefined()
    expect(deps.auditError).toHaveBeenCalledWith(
      'alice',
      'sync',
      'Garmin: processing pushed dailies failed',
      {
        error: 'boom',
      },
    )
    expect(deps.upsertSyncState).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ error_message: 'boom', status: 'error' }),
    )
  })
})

describe('lifecycle', () => {
  const deregistration = { deregistrations: [{ userAccessToken: OLD_TOKEN, userId: GARMIN_USER }] }

  test('is not stored', async () => {
    const deps = makeDeps()
    await receive(deps, {
      ...deregistration,
      userPermissionsChange: [{ permissions: [], userId: GARMIN_USER }],
    })
    expect(storedRecords(deps)).toEqual([])
  })

  test('a deregistration is ignored while the grant still answers the same Garmin user', async () => {
    const deps = makeDeps()
    const result = await receive(deps, deregistration)
    await result.process!()
    expect(deps.probeGrant).toHaveBeenCalledWith('alice')
    expect(deps.forgetGrant).not.toHaveBeenCalled()
    expect(deps.auditInfo).toHaveBeenCalledWith('alice', 'auth', expect.stringContaining('ignored'))
  })

  test('a deregistration is honoured when the grant is gone, without calling Garmin', async () => {
    const deps = makeDeps({ probe: { status: 'gone' } })
    const result = await receive(deps, deregistration)
    await result.process!()
    expect(deps.forgetGrant).toHaveBeenCalledWith('alice')
    expect(deps.auditWarn).toHaveBeenCalledWith(
      'alice',
      'auth',
      'Garmin: access removed from the Garmin side',
    )
  })

  test('a deregistration is left alone when Garmin could not be asked', async () => {
    const deps = makeDeps({ probe: { error: 'Garmin user id request 503', status: 'unknown' } })
    const result = await receive(deps, deregistration)
    await result.process!()
    expect(deps.forgetGrant).not.toHaveBeenCalled()
    expect(deps.auditWarn).toHaveBeenCalledWith('alice', 'auth', expect.any(String), {
      error: 'Garmin user id request 503',
    })
  })

  test('a deregistration is ignored when the grant belongs to another Garmin user', async () => {
    const deps = makeDeps({ probe: { garminUserId: 'garmin-user-2', status: 'alive' } })
    const result = await receive(deps, deregistration)
    await result.process!()
    expect(deps.forgetGrant).not.toHaveBeenCalled()
  })

  test('a permissions change is stored as the grant scopes and audited by name', async () => {
    const deps = makeDeps()
    const result = await receive(deps, {
      userPermissionsChange: [{ permissions: ['HEALTH_EXPORT', 7, 'ACTIVITY_EXPORT'], userId: GARMIN_USER }],
    })
    await result.process!()
    expect(deps.updateGrantScopes).toHaveBeenCalledWith('alice', ['HEALTH_EXPORT', 'ACTIVITY_EXPORT'])
    expect(deps.auditInfo).toHaveBeenCalledWith('alice', 'auth', expect.any(String), {
      permissions: ['HEALTH_EXPORT', 'ACTIVITY_EXPORT'],
    })
  })

  test('a failing lifecycle step is audited and does not reject', async () => {
    const deps = makeDeps()
    deps.updateGrantScopes.mockRejectedValueOnce(new Error('db down'))
    const result = await receive(deps, { userPermissionsChange: [{ permissions: [], userId: GARMIN_USER }] })
    await expect(result.process!()).resolves.toBeUndefined()
    expect(deps.auditError).toHaveBeenCalledWith('alice', 'auth', expect.any(String), { error: 'db down' })
  })
})

describe('what is said', () => {
  test('no audit or log call contains the token, the URL, the old access token or a Garmin user id', async () => {
    const deps = makeDeps({ probe: { status: 'gone' } })
    const result = await receive(deps, {
      'bad key!': [{ userId: 'garmin-user-x' }],
      dailies: [daily(), daily({ userId: 'garmin-user-unknown' })],
      deregistrations: [{ userAccessToken: OLD_TOKEN, userId: GARMIN_USER }],
      userPermissionsChange: [{ permissions: ['HEALTH_EXPORT'], userId: GARMIN_USER }],
    })
    deps.processGarminData.mockRejectedValueOnce(new Error('boom'))
    await result.process!()
    const said = everythingSaid(deps)
    expect(said).not.toContain(TOKEN)
    expect(said).not.toContain('webhooks/garmin')
    expect(said).not.toContain(OLD_TOKEN)
    expect(said).not.toContain('garmin-user-')
  })
})

describe('createSerialQueue', () => {
  test('runs jobs one after another and keeps going after a failure', async () => {
    const order: string[] = []
    const errors: unknown[] = []
    const enqueue = createSerialQueue((error) => errors.push(error))
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    enqueue(async () => {
      order.push('a:start')
      await gate
      order.push('a:end')
    })
    enqueue(async () => {
      order.push('b')
      throw new Error('b failed')
    })
    const last = enqueue(async () => {
      order.push('c')
    })
    await Promise.resolve()
    expect(order).toEqual(['a:start'])
    release()
    await last
    expect(order).toEqual(['a:start', 'a:end', 'b', 'c'])
    expect(errors).toHaveLength(1)
  })
})
