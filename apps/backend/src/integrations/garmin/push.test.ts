import { describe, expect, test, vi } from 'vitest'

import type { RawRecord, SyncState } from '../../db/types.ts'
import type { GarminGrantProbe } from './oauth-client.ts'
import type { GarminDataType } from './process.ts'

import {
  createSerialQueue,
  garminPushExternalId,
  type GarminPushJob,
  type GarminPushProcessDeps,
  garminPushRecordType,
  garminPushToken,
  garminPushTypeOfRecordType,
  garminPushUrl,
  type GarminPushDeps,
  isGarminPushToken,
  processGarminPushJob,
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
  const rawStore = new Map<string, unknown>()
  const jobs: GarminPushJob[] = []
  const deps = {
    auditError: vi.fn(async () => {}),
    auditInfo: vi.fn(async () => {}),
    auditWarn: vi.fn(async () => {}),
    forgetGrant: vi.fn(async () => {}),
    getClientId: vi.fn(async () => (options.clientId === undefined ? CLIENT_ID : options.clientId)),
    enqueuePush: vi.fn(async (job: GarminPushJob) => {
      jobs.push(job)
    }),
    getDisabledDataTypes: vi.fn(
      async (_user: string): Promise<readonly GarminDataType[]> => options.disabled ?? [],
    ),
    getPushRecords: vi.fn(async (user: string, recordType: string, externalIds: string[]) => {
      const found = new Map<string, unknown>()
      for (const id of externalIds) {
        const data = rawStore.get(`${user}|${recordType}|${id}`)
        if (data !== undefined) found.set(id, data)
      }
      return found
    }),
    getUsernameByGarminUserId: vi.fn(async (id: string) => users[id] ?? null),
    insertRawRecords: vi.fn(async (user: string, records: RawRecord[]) => {
      for (const record of records) {
        rawStore.set(`${user}|${record.record_type}|${record.external_id}`, record.data)
      }
    }),
    jobs,
    rawStore,
    insertTimeSeries: vi.fn(async () => {}),
    isReadOnly: vi.fn(async (user: string) => (options.readOnly ?? []).includes(user)),
    logWarn: vi.fn(),
    now: () => NOW,
    onActivitySynced: vi.fn((_user: string, _start: Date, _end: Date) => {}),
    probeGrant: vi.fn(async () => options.probe ?? { garminUserId: GARMIN_USER, status: 'alive' as const }),
    processGarminData: vi.fn(async (_user: string, _dataType: GarminDataType, _data: unknown) => 1),
    pushToken: TOKEN,
    syncActivityFile: vi.fn(async (_user: string, _garminActivityId: number) => {}),
    updateGrantScopes: vi.fn(async () => true),
    upsertSyncState: vi.fn(async (_user: string, _state: SyncState) => {}),
  }
  return deps satisfies GarminPushDeps & GarminPushProcessDeps
}

type Deps = ReturnType<typeof makeDeps>

const receive = (deps: Deps, body: unknown, overrides: { token?: string; clientIdHeader?: string } = {}) =>
  receiveGarminPush(deps, {
    body,
    clientIdHeader: overrides.clientIdHeader,
    token: overrides.token ?? TOKEN,
  })

/** Runs every queued job as the queue's worker would, oldest first. */
const processJobs = async (deps: Deps) => {
  for (const job of deps.jobs.splice(0)) await processGarminPushJob(deps, job)
}

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

  test('an activity file notice is keyed by its activity and file type', () => {
    expect(garminPushExternalId('activityFiles', { activityId: 7, fileType: 'FIT', summaryId: 's' })).toBe(
      'file-7-fit',
    )
    expect(garminPushExternalId('activityFiles', { activityId: '8', fileType: 'GPX' })).toBe('file-8-gpx')
    expect(garminPushExternalId('activityFiles', { activityId: 9 })).toBe('file-9-unknown')
    expect(garminPushExternalId('activityFiles', { activityId: 'x', summaryId: 's' })).toBe('s')
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
    await receive(deps, {
      dailies: [daily({ timeOffsetHeartRateSamples: { '0': 60 } })],
    })
    expect(storedRecords(deps)).toHaveLength(1)
    await processJobs(deps)
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

describe('queueing', () => {
  test('enqueues one job per user naming the stored records, and processes nothing before the answer', async () => {
    const deps = makeDeps({ users: { [GARMIN_USER]: 'alice', 'garmin-user-2': 'bob' } })
    const result = await receive(deps, {
      dailies: [daily(), daily({ summaryId: 'sd-2' }), daily({ summaryId: 'sd-2' })],
      epochs: [daily({ summaryId: 'e-1' }), daily({ summaryId: 'e-2', userId: 'garmin-user-2' })],
    })
    expect(result).toEqual({ status: 200 })
    expect(deps.processGarminData).not.toHaveBeenCalled()
    expect(deps.enqueuePush.mock.calls.map((call) => call[0])).toEqual([
      {
        records: [
          { external_id: 'sd-1', type: 'dailies' },
          { external_id: 'sd-2', type: 'dailies' },
          { external_id: 'e-1', type: 'epochs' },
        ],
        user: 'alice',
      },
      { records: [{ external_id: 'e-2', type: 'epochs' }], user: 'bob' },
    ])
  })

  test('the job carries no item data, no Garmin user id and no token', async () => {
    const deps = makeDeps()
    await receive(deps, { dailies: [daily()] })
    const job = JSON.stringify(deps.enqueuePush.mock.calls)
    expect(job).not.toContain(GARMIN_USER)
    expect(job).not.toContain(OLD_TOKEN)
    expect(job).not.toContain('steps')
  })

  test('a failure to enqueue is a 500 so Garmin retries', async () => {
    const deps = makeDeps()
    deps.enqueuePush.mockRejectedValueOnce(new Error('queue down'))
    expect(await receive(deps, { dailies: [daily()] })).toEqual({ status: 500 })
    expect(deps.logWarn).toHaveBeenCalledWith(expect.stringContaining('queueing failed'))
  })

  test('nothing is enqueued for a read-only account or when nothing was stored', async () => {
    const readOnly = makeDeps({ readOnly: ['alice'] })
    await receive(readOnly, { dailies: [daily()] })
    expect(readOnly.enqueuePush).not.toHaveBeenCalled()

    const nothing = makeDeps()
    await receive(nothing, { dailies: [{ steps: 1, userId: GARMIN_USER }] })
    expect(nothing.enqueuePush).not.toHaveBeenCalled()
  })
})

describe('processing a job', () => {
  test('processes the stored records', async () => {
    const deps = makeDeps()
    await receive(deps, { dailies: [daily()] })
    await processJobs(deps)
    expect(deps.processGarminData).toHaveBeenCalledWith('alice', 'dailySummary', expect.any(Object))
  })

  test('reads each record as it is stored now, not as it was pushed', async () => {
    const deps = makeDeps()
    await receive(deps, { dailies: [daily({ steps: 1000 })] })
    await receive(deps, { dailies: [daily({ steps: 2500 })] })
    await processJobs(deps)
    expect(
      deps.processGarminData.mock.calls.map((call) => (call[2] as { totalSteps: number }).totalSteps),
    ).toEqual([2500, 2500])
  })

  test('skips a record that no longer exists', async () => {
    const deps = makeDeps()
    await processGarminPushJob(deps, {
      records: [
        { external_id: 'gone', type: 'dailies' },
        { external_id: 'sd-1', type: 'dailies' },
      ],
      user: 'alice',
    })
    expect(deps.processGarminData).not.toHaveBeenCalled()

    await receive(deps, { dailies: [daily()] })
    deps.jobs.splice(0)
    await processGarminPushJob(deps, {
      records: [
        { external_id: 'gone', type: 'dailies' },
        { external_id: 'sd-1', type: 'dailies' },
      ],
      user: 'alice',
    })
    expect(deps.processGarminData).toHaveBeenCalledTimes(1)
  })

  test('respects the data types disabled by the time it runs', async () => {
    const deps = makeDeps()
    await receive(deps, {
      dailies: [daily({ timeOffsetHeartRateSamples: { '0': 60 } })],
      sleeps: [
        { durationInSeconds: 3600, startTimeInSeconds: 1795305600, summaryId: 's-1', userId: GARMIN_USER },
      ],
    })
    deps.getDisabledDataTypes.mockResolvedValue(['heartRate', 'sleep'])
    await processJobs(deps)
    expect(deps.processGarminData.mock.calls.map((call) => call[1])).toEqual(['dailySummary'])
    expect(deps.upsertSyncState.mock.calls.map((call) => call[1].data_type)).toEqual(['dailies'])
  })

  test('does nothing for an account that became read-only', async () => {
    const deps = makeDeps()
    await receive(deps, { dailies: [daily()] })
    deps.isReadOnly.mockResolvedValue(true)
    await processJobs(deps)
    expect(deps.getPushRecords).not.toHaveBeenCalled()
    expect(deps.processGarminData).not.toHaveBeenCalled()
  })

  test('writes direct points and a garmin_push sync state per type', async () => {
    const deps = makeDeps()
    await receive(deps, {
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
    await processJobs(deps)
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

  test('a failing type is audited and marked, the others are still processed, and the job fails for a retry', async () => {
    const deps = makeDeps()
    deps.processGarminData.mockImplementation(async (_user, dataType) => {
      if (dataType === 'dailySummary') throw new Error('boom')
      return 1
    })
    await receive(deps, {
      dailies: [daily()],
      hrv: [{ calendarDate: '2026-11-16', lastNightAvg: 50, summaryId: 'h-1', userId: GARMIN_USER }],
    })
    await expect(processJobs(deps)).rejects.toThrow('dailies')
    expect(deps.auditError).toHaveBeenCalledWith(
      'alice',
      'sync',
      'Garmin: processing pushed dailies failed',
      {
        error: 'boom',
      },
    )
    expect(deps.upsertSyncState.mock.calls.map((call) => [call[1].data_type, call[1].status])).toEqual([
      ['dailies', 'error'],
      ['hrv', 'idle'],
    ])
    expect(deps.upsertSyncState).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ error_message: 'boom', status: 'error' }),
    )
  })
})

describe('a replay job', () => {
  const sleep = {
    durationInSeconds: 3600,
    startTimeInSeconds: 1795305600,
    summaryId: 's-1',
    userId: GARMIN_USER,
  }

  test('processes the records and tells the notifier but writes no push sync state', async () => {
    const deps = makeDeps()
    await receive(deps, { dailies: [daily()], sleeps: [sleep] })
    const [job] = deps.jobs.splice(0)
    await processGarminPushJob(deps, { ...job!, replay: true })
    expect(deps.processGarminData.mock.calls.map((call) => call[1])).toEqual(['dailySummary', 'sleep'])
    expect(deps.onActivitySynced).toHaveBeenCalledTimes(1)
    expect(deps.upsertSyncState).not.toHaveBeenCalled()
  })

  test('a failing type is audited and fails the job, still without a push sync state', async () => {
    const deps = makeDeps()
    deps.processGarminData.mockRejectedValueOnce(new Error('boom'))
    await receive(deps, { dailies: [daily()] })
    const [job] = deps.jobs.splice(0)
    await expect(processGarminPushJob(deps, { ...job!, replay: true })).rejects.toThrow('dailies')
    expect(deps.auditError).toHaveBeenCalledWith(
      'alice',
      'sync',
      'Garmin: processing pushed dailies failed',
      {
        error: 'boom',
      },
    )
    expect(deps.upsertSyncState).not.toHaveBeenCalled()
  })
})

describe('reprocessing lookup', () => {
  test('a stored record type maps back to its Garmin type key', () => {
    expect(garminPushTypeOfRecordType('garmin_push_dailies')).toBe('dailies')
    expect(garminPushTypeOfRecordType('garmin_push_move_iq_activities')).toBe('moveIQActivities')
    expect(garminPushTypeOfRecordType('garmin_push_activity_files')).toBe('activityFiles')
    expect(garminPushTypeOfRecordType('garmin_push_something_new')).toBeUndefined()
    expect(garminPushTypeOfRecordType('garmin_sleep')).toBeUndefined()
  })
})

describe('activities and their files', () => {
  const START = 1795305600
  const activity = (overrides: Record<string, unknown> = {}) => ({
    activityId: 4242,
    activityType: 'RUNNING',
    durationInSeconds: 1800,
    startTimeInSeconds: START,
    summaryId: 'a-1',
    userId: GARMIN_USER,
    ...overrides,
  })
  const fileNotice = (overrides: Record<string, unknown> = {}) => ({
    activityId: 4242,
    callbackURL: 'https://apis.garmin.com/wellness-api/rest/activityFile?id=1&token=fake-callback-token',
    fileType: 'FIT',
    summaryId: 'f-1',
    userId: GARMIN_USER,
    ...overrides,
  })

  test('activity files are handled after activities, whatever the envelope order', async () => {
    const deps = makeDeps()
    const order: string[] = []
    deps.processGarminData.mockImplementation(async () => {
      order.push('activity')
      return 1
    })
    deps.syncActivityFile.mockImplementation(async () => {
      order.push('file')
    })
    await receive(deps, { activityFiles: [fileNotice()], activities: [activity()] })
    await processJobs(deps)
    expect(order).toEqual(['activity', 'file', 'file'])
    expect(deps.upsertSyncState.mock.calls.map((call) => call[1].data_type)).toEqual([
      'activities',
      'activityFiles',
    ])
  })

  test('an activity is processed as the pull reads it', async () => {
    const deps = makeDeps()
    await receive(deps, { manuallyUpdatedActivities: [activity()] })
    await processJobs(deps)
    expect(deps.processGarminData).toHaveBeenCalledWith('alice', 'activities', [
      expect.objectContaining({ activityId: 4242, activityType: { typeKey: 'running' } }),
    ])
  })

  test('the file is asked for once per activity item and per FIT notice, not for a TCX one', async () => {
    const deps = makeDeps()
    await receive(deps, {
      activities: [activity(), activity({ activityId: '4243', summaryId: 'a-2' })],
      activityFiles: [
        fileNotice(),
        fileNotice({ activityId: 4244, fileType: 'fit' }),
        fileNotice({ activityId: 4245, fileType: 'TCX' }),
      ],
      manuallyUpdatedActivities: [activity({ activityId: 4246, summaryId: 'm-1' })],
    })
    await processJobs(deps)
    expect(deps.syncActivityFile.mock.calls).toEqual([
      ['alice', 4242],
      ['alice', 4243],
      ['alice', 4246],
      ['alice', 4242],
      ['alice', 4244],
    ])
  })

  test('nothing is stored or asked for when activities are turned off', async () => {
    const deps = makeDeps({ disabled: ['activities'] })
    const result = await receive(deps, {
      activities: [activity()],
      activityDetails: [activity({ summaryId: 'd-1' })],
      activityFiles: [fileNotice()],
      manuallyUpdatedActivities: [activity({ summaryId: 'm-1' })],
    })
    expect(storedRecords(deps)).toEqual([])
    expect(result.process).toBeUndefined()
    expect(deps.syncActivityFile).not.toHaveBeenCalled()
  })

  test('activity details are kept raw only', async () => {
    const deps = makeDeps()
    await receive(deps, { activityDetails: [activity({ summaryId: 'd-1' })] })
    expect(storedRecords(deps)).toHaveLength(1)
    await processJobs(deps)
    expect(deps.processGarminData).not.toHaveBeenCalled()
    expect(deps.syncActivityFile).not.toHaveBeenCalled()
    expect(deps.onActivitySynced).not.toHaveBeenCalled()
  })

  test('a failing file sync is audited under its type and fails the job', async () => {
    const deps = makeDeps()
    deps.syncActivityFile.mockRejectedValueOnce(new Error('boom'))
    await receive(deps, { activityFiles: [fileNotice()] })
    await expect(processJobs(deps)).rejects.toThrow()
    expect(deps.auditError).toHaveBeenCalledWith(
      'alice',
      'sync',
      'Garmin: processing pushed activityFiles failed',
      {
        error: 'boom',
      },
    )
  })

  test('tells the activity notifier the span of pushed sleeps and activities, not of dailies', async () => {
    const deps = makeDeps()
    await receive(deps, {
      activities: [
        activity(),
        activity({
          activityId: 4243,
          durationInSeconds: 600,
          startTimeInSeconds: START + 7200,
          summaryId: 'a-2',
        }),
      ],
      dailies: [daily()],
      sleeps: [
        {
          durationInSeconds: 28800,
          startTimeInSeconds: START - 28800,
          summaryId: 's-1',
          userId: GARMIN_USER,
        },
      ],
    })
    await processJobs(deps)
    expect(deps.onActivitySynced.mock.calls).toEqual(
      expect.arrayContaining([
        ['alice', new Date(START * 1000), new Date((START + 7800) * 1000)],
        ['alice', new Date((START - 28800) * 1000), new Date(START * 1000)],
      ]),
    )
    expect(deps.onActivitySynced).toHaveBeenCalledTimes(2)
  })

  test('without a usable time the notifier gets the last day', async () => {
    const deps = makeDeps()
    await receive(deps, {
      sleeps: [{ calendarDate: '2026-11-16', summaryId: 's-1', userId: GARMIN_USER }],
    })
    await processJobs(deps)
    expect(deps.onActivitySynced).toHaveBeenCalledWith('alice', new Date(NOW.getTime() - 86_400_000), NOW)
  })

  test('the notifier is not told about a type that failed', async () => {
    const deps = makeDeps()
    deps.processGarminData.mockRejectedValueOnce(new Error('boom'))
    await receive(deps, { activities: [activity()] })
    await expect(processJobs(deps)).rejects.toThrow()
    expect(deps.onActivitySynced).not.toHaveBeenCalled()
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
    await expect(processJobs(deps)).rejects.toThrow()
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
