/**
 * A pushed day and night must land as the same rows the pull writes for them, so an
 * account with both connections gets one copy, not two.
 */
import { Encoder, Profile } from '@garmin/fitsdk'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { query } from '../../db/connection.ts'
import {
  findActivityByGarminActivityId,
  getRawRecordsByExternalIds,
  insertRawRecords,
  insertTimeSeries,
  markActivityDetailSynced,
  queryRawRecords,
  upsertSyncState,
} from '../../db/index.ts'
import { auditError, auditInfo, auditWarn } from '../../services/audit-log.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../../test/db-test-helper.ts'
import { defaultGarminProcessDeps, processActivityFit, processGarminData } from './process.ts'
import { syncPushedActivityFile } from './push-activity-file.ts'
import {
  type GarminPushJob,
  type GarminPushProcessDeps,
  garminPushRecordType,
  garminPushToken,
  processGarminPushJob,
  receiveGarminPush,
} from './push.ts'

const CONTAINER_TIMEOUT = 120_000
const TOKEN = garminPushToken('fake-session-secret')

// 2025-01-15T00:00:00Z
const DAY_START = 1736899200
const SLEEP_START = DAY_START - 2 * 3600

const pullDaily = {
  activeKilocalories: 500,
  averageSpo2: 96,
  averageStressLevel: 30,
  calendarDate: '2025-01-15',
  floorsAscended: 12,
  restingHeartRate: 52,
  totalDistanceMeters: 8000,
  totalKilocalories: 2200,
  totalSteps: 10234,
}

const pushDaily = {
  activeKilocalories: 500,
  averageSpo2: 96,
  averageStressLevel: 30,
  bmrKilocalories: 1700,
  calendarDate: '2025-01-15',
  distanceInMeters: 8000,
  floorsClimbed: 12,
  restingHeartRateInBeatsPerMinute: 52,
  startTimeInSeconds: DAY_START,
  steps: 10234,
  summaryId: 'sd-1',
  userId: 'garmin-user-1',
}

const gmt = (seconds: number) =>
  new Date(seconds * 1000)
    .toISOString()
    .replace('Z', '')
    .replace(/\.\d+$/, '.0')

const pullSleep = {
  avgOvernightHrv: 0,
  dailySleepDTO: {
    awakeSleepSeconds: 600,
    calendarDate: '2025-01-15',
    dailyNapDTOS: [
      {
        napEndTimestampGMT: '2025-01-15T12:47:46',
        napStartTimestampGMT: '2025-01-15T12:17:46',
        napTimeSec: 1800,
      },
    ],
    deepSleepSeconds: 5400,
    lightSleepSeconds: 14400,
    remSleepSeconds: 7200,
    sleepEndTimestampGMT: (SLEEP_START + 27600) * 1000,
    sleepScores: { overall: { value: 82 } },
    sleepStartTimestampGMT: SLEEP_START * 1000,
  },
  restingHeartRate: 0,
  sleepHeartRate: [],
  sleepLevels: [
    { activityLevel: 0, endGMT: gmt(SLEEP_START + 5400), startGMT: gmt(SLEEP_START) },
    { activityLevel: 1, endGMT: gmt(SLEEP_START + 19800), startGMT: gmt(SLEEP_START + 5400) },
    { activityLevel: 2, endGMT: gmt(SLEEP_START + 27000), startGMT: gmt(SLEEP_START + 19800) },
    { activityLevel: 3, endGMT: gmt(SLEEP_START + 27600), startGMT: gmt(SLEEP_START + 27000) },
  ],
}

const pushSleep = {
  awakeDurationInSeconds: 600,
  calendarDate: '2025-01-15',
  deepSleepDurationInSeconds: 5400,
  durationInSeconds: 27000,
  lightSleepDurationInSeconds: 14400,
  naps: [{ napDurationInSeconds: 1800, napStartTimeInSeconds: DAY_START + 12 * 3600 + 17 * 60 + 46 }],
  overallSleepScore: { value: 82 },
  remSleepInSeconds: 7200,
  sleepLevelsMap: {
    awake: [{ endTimeInSeconds: SLEEP_START + 27600, startTimeInSeconds: SLEEP_START + 27000 }],
    deep: [{ endTimeInSeconds: SLEEP_START + 5400, startTimeInSeconds: SLEEP_START }],
    light: [{ endTimeInSeconds: SLEEP_START + 19800, startTimeInSeconds: SLEEP_START + 5400 }],
    rem: [{ endTimeInSeconds: SLEEP_START + 27000, startTimeInSeconds: SLEEP_START + 19800 }],
  },
  startTimeInSeconds: SLEEP_START,
  summaryId: 'sl-1',
  userAccessToken: 'fake-user-access-token',
  userId: 'garmin-user-1',
}

const timeSeriesRows = async (user: string) =>
  (
    await query(
      user,
      `SELECT metric, source, time, value, unit FROM time_series WHERE deleted_at IS NULL ORDER BY metric, time`,
      [],
    )
  ).rows

const activityRows = async (user: string) =>
  (
    await query(
      user,
      `SELECT activity_type, source, external_id, start_time, end_time, data FROM activities
       WHERE deleted_at IS NULL ORDER BY start_time`,
      [],
    )
  ).rows

const pushBody = async (
  user: string,
  body: Record<string, unknown>,
  download: (
    url: string,
    token: string,
  ) => Promise<{ status: number; bytes: Uint8Array | null }> = async () => ({
    bytes: null,
    status: 404,
  }),
) => {
  const onActivitySynced = vi.fn()
  const jobs: GarminPushJob[] = []
  const result = await receiveGarminPush(
    {
      auditError,
      auditInfo,
      auditWarn,
      enqueuePush: async (job) => {
        jobs.push(job)
      },
      forgetGrant: vi.fn(),
      getClientId: async () => 'fake-client-id',
      getDisabledDataTypes: async () => [],
      getUsernameByGarminUserId: async () => user,
      insertRawRecords,
      isReadOnly: async () => false,
      logWarn: vi.fn(),
      now: () => new Date('2026-11-17T10:00:00Z'),
      probeGrant: vi.fn(),
      pushToken: TOKEN,
      updateGrantScopes: vi.fn(),
    },
    { body, clientIdHeader: undefined, token: TOKEN },
  )
  expect(result.status).toBe(200)
  const processDeps: GarminPushProcessDeps = {
    auditError,
    getDisabledDataTypes: async () => [],
    getPushRecords: (owner, recordType, externalIds) =>
      getRawRecordsByExternalIds(owner, 'garmin', recordType, externalIds),
    insertTimeSeries,
    isReadOnly: async () => false,
    now: () => new Date('2026-11-17T10:00:00Z'),
    onActivitySynced,
    processGarminData: (u, dataType, data) =>
      processGarminData(u, dataType, data, {
        ...defaultGarminProcessDeps,
        insertRawRecord: async () => {},
      }),
    syncActivityFile: (u, garminActivityId) =>
      syncPushedActivityFile(
        {
          auditError,
          auditInfo,
          auditWarn,
          download,
          findActivityByGarminActivityId,
          getAccessToken: async () => 'fake-access-token',
          getFileNotice: async (owner, id) =>
            (
              await queryRawRecords(owner, {
                external_id: `file-${id}-fit`,
                limit: 1,
                record_type: garminPushRecordType('activityFiles'),
                source: 'garmin',
              })
            ).rows[0]?.data ?? null,
          markActivityDetailSynced,
          processActivityFit,
        },
        u,
        garminActivityId,
      ),
    upsertSyncState,
  }
  for (const job of jobs) await processGarminPushJob(processDeps, job)
  return { onActivitySynced }
}

const pushOnce = (user: string) => pushBody(user, { dailies: [pushDaily], sleeps: [pushSleep] })

describe('Garmin push against the pull (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('a pushed day and night write the rows the pull writes', async () => {
    const user = getTestUser()
    await processGarminData(user, 'dailySummary', pullDaily)
    await processGarminData(user, 'sleep', pullSleep)
    const pulledPoints = await timeSeriesRows(user)
    const pulledActivities = await activityRows(user)
    expect(pulledActivities.map((a) => a.external_id)).toEqual([
      'garmin-sleep-2025-01-15',
      'garmin-nap-2025-01-15T12:17:46',
    ])

    await cleanTestDb()
    await pushOnce(user)

    expect(await timeSeriesRows(user)).toEqual(pulledPoints)
    expect(await activityRows(user)).toEqual(pulledActivities)
  })

  test('a push after the pull adds no second copy and leaves the pull raw records alone', async () => {
    const user = getTestUser()
    await processGarminData(user, 'dailySummary', pullDaily)
    await processGarminData(user, 'sleep', pullSleep)
    const pulledPoints = await timeSeriesRows(user)
    const pulledActivities = await activityRows(user)

    await pushOnce(user)

    expect(await timeSeriesRows(user)).toEqual(pulledPoints)
    expect(await activityRows(user)).toEqual(pulledActivities)
    const raw = await query(
      user,
      `SELECT record_type, external_id, data FROM raw_records WHERE source = 'garmin' ORDER BY record_type`,
      [],
    )
    expect(raw.rows.map((r) => [r.record_type, r.external_id])).toEqual([
      ['garmin_daily_summary', 'garmin-summary-2025-01-15'],
      ['garmin_push_dailies', 'sd-1'],
      ['garmin_push_sleeps', 'sl-1'],
      ['garmin_sleep', 'garmin-sleep-2025-01-15'],
    ])
    expect(raw.rows.find((r) => r.record_type === 'garmin_daily_summary')!.data).toEqual(pullDaily)
    expect(JSON.stringify(raw.rows)).not.toContain('fake-user-access-token')
    expect(JSON.stringify(raw.rows)).not.toContain('garmin-user-1')
  })

  test('writes a garmin_push sync state per type', async () => {
    const user = getTestUser()
    await pushOnce(user)
    const states = await query(
      user,
      `SELECT data_type, status FROM sync_state WHERE provider = 'garmin_push' ORDER BY data_type`,
      [],
    )
    expect(states.rows).toEqual([
      { data_type: 'dailies', status: 'idle' },
      { data_type: 'sleeps', status: 'idle' },
    ])
  })

  describe('activities and their FIT files', () => {
    const ACTIVITY_ID = 4242
    const RUN_START = DAY_START + 7 * 3600
    const at = (seconds: number) => new Date((RUN_START + seconds) * 1000)
    const semicircles = (degrees: number) => Math.round((degrees * 2 ** 31) / 180)

    const fitBytes = (): Uint8Array => {
      const encoder = new Encoder()
      encoder.onMesg(Profile.MesgNum.FILE_ID, {
        manufacturer: 'development',
        product: 1,
        timeCreated: at(0),
        type: 'activity',
      } as never)
      for (const second of [1, 2, 3]) {
        encoder.onMesg(Profile.MesgNum.RECORD, {
          heartRate: 120 + second,
          positionLat: semicircles(57.65 + second / 10_000),
          positionLong: semicircles(12.62),
          timestamp: at(second),
        } as never)
      }
      encoder.onMesg(Profile.MesgNum.SESSION, {
        sport: 'running',
        startTime: at(0),
        timestamp: at(1800),
        totalElapsedTime: 1800,
      } as never)
      return encoder.close()
    }

    const activities = {
      activities: [
        {
          activeKilocalories: 410,
          activityId: ACTIVITY_ID,
          activityName: 'Morning run',
          activityType: 'RUNNING',
          durationInSeconds: 1800,
          startTimeInSeconds: RUN_START,
          summaryId: 'a-1',
          userId: 'garmin-user-1',
        },
      ],
    }
    const files = {
      activityFiles: [
        {
          activityId: ACTIVITY_ID,
          callbackURL:
            'https://apis.garmin.com/wellness-api/rest/activityFile?id=1&token=fake-callback-token',
          fileType: 'FIT',
          summaryId: 'f-1',
          userId: 'garmin-user-1',
        },
      ],
    }

    const expectDetailWritten = async (user: string) => {
      const [activity] = await activityRows(user)
      expect(activity).toMatchObject({
        activity_type: 'running',
        external_id: `garmin-activity-${ACTIVITY_ID}`,
        source: 'garmin',
        start_time: at(0),
      })
      expect(activity!.data).toMatchObject({
        calories: 410,
        detail_synced: true,
        garmin_activity_id: ACTIVITY_ID,
      })
      const heartRate = (await timeSeriesRows(user)).filter((row) => row.metric === 'heart_rate')
      expect(heartRate.map((row) => row.value)).toEqual([121, 122, 123])
      const tracks = await query(user, `SELECT source FROM activity_tracks`, [])
      expect(tracks.rows).toEqual([{ source: 'garmin' }])
    }

    test('an activity push then its file notice', async () => {
      const user = getTestUser()
      const download = vi.fn(async () => ({ bytes: fitBytes(), status: 200 }))
      await pushBody(user, activities, download)
      expect(download).not.toHaveBeenCalled()
      expect((await activityRows(user))[0]!.data.detail_synced).toBeUndefined()

      const { onActivitySynced } = await pushBody(user, files, download)
      expect(download).toHaveBeenCalledTimes(1)
      expect(onActivitySynced).not.toHaveBeenCalled()
      await expectDetailWritten(user)
    })

    test('a manual edit without a name or duration keeps the stored title and end', async () => {
      const user = getTestUser()
      await pushBody(user, activities)
      await pushBody(user, {
        manuallyUpdatedActivities: [
          {
            activityId: ACTIVITY_ID,
            activityType: 'RUNNING',
            startTimeInSeconds: RUN_START,
            summaryId: 'm-1',
            userId: 'garmin-user-1',
          },
        ],
      })
      const rows = await query(user, `SELECT title, end_time FROM activities WHERE deleted_at IS NULL`, [])
      expect(rows.rows).toEqual([{ end_time: at(1800), title: 'Morning run' }])
    })

    test('a file notice then its activity', async () => {
      const user = getTestUser()
      const download = vi.fn(async () => ({ bytes: fitBytes(), status: 200 }))
      await pushBody(user, files, download)
      expect(download).not.toHaveBeenCalled()

      const { onActivitySynced } = await pushBody(user, activities, download)
      expect(download).toHaveBeenCalledTimes(1)
      expect(onActivitySynced).toHaveBeenCalledWith(user, at(0), at(1800))
      await expectDetailWritten(user)

      await pushBody(user, { ...activities, ...files }, download)
      expect(download).toHaveBeenCalledTimes(1)
    })
  })
})
