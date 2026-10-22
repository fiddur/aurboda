import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { GARMIN_HC_ORIGIN } from '../services/source-identity.ts'
import { cleanTestDb, getTestDbClient, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { repairGarminSleepStages } from './repair-garmin-sleep-stages.ts'

const CONTAINER_TIMEOUT = 120_000

/** Local midnight of `date` in +02:00, as Garmin's clientRecordId. */
const localMidnight = (date: string): string => String(Date.parse(`${date}T00:00:00+02:00`))

/** The HC payload the Android app uploads for the night ending on `date` (UTC `Z` timestamps). */
const hcPayload = (date: string) => {
  const prev = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  return {
    endTime: `${date}T05:00:00Z`,
    metadata: { clientRecordId: localMidnight(date), dataOrigin: GARMIN_HC_ORIGIN, id: `hc-${date}` },
    stages: [{ endTime: `${date}T05:00:00Z`, stage: 4, startTime: `${prev}T21:00:00Z` }],
    startTime: `${prev}T21:00:00Z`,
  }
}

const insertSleep = async (date: string, data: Record<string, unknown>): Promise<void> => {
  const prev = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  await getTestDbClient().query(
    `INSERT INTO activities (source, external_id, activity_type, start_time, end_time, data)
     VALUES ('garmin', $1, 'sleep', $2, $3, $4)`,
    [`garmin-sleep-${date}`, `${prev}T21:00:00Z`, `${date}T05:00:00Z`, JSON.stringify(data)],
  )
}

const sleepData = async (): Promise<Record<string, Record<string, unknown>>> => {
  const { rows } = await getTestDbClient().query<{ external_id: string; data: Record<string, unknown> }>(
    `SELECT external_id, data FROM activities WHERE source = 'garmin' ORDER BY external_id`,
  )
  return Object.fromEntries(rows.map((r) => [r.external_id, r.data]))
}

describe('repairGarminSleepStages integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('is a no-op on an empty database', async () => {
    await repairGarminSleepStages(getTestDbClient())
    expect(await sleepData()).toEqual({})
  })

  test('moves each misfiled HC payload onto its own night and fills stages from raw sleepLevels', async () => {
    const garmin = { deep_sleep_seconds: 3600, sleep_score: 80 }
    await insertSleep('2026-09-22', { ...garmin, ...hcPayload('2026-09-23') })
    await insertSleep('2026-09-23', { ...garmin, ...hcPayload('2026-09-24') })
    await insertSleep('2026-09-24', { ...garmin, ...hcPayload('2026-09-25') })
    await insertSleep('2026-09-25', garmin)
    await getTestDbClient().query(
      `INSERT INTO raw_records (source, record_type, external_id, recorded_at, data)
       VALUES ('garmin', 'garmin_sleep', 'garmin-sleep-2026-09-22', '2026-09-22T12:00:00Z', $1)`,
      [
        JSON.stringify({
          sleepLevels: [
            { activityLevel: 0, endGMT: '2026-09-21T23:00:00.0', startGMT: '2026-09-21T22:00:00.0' },
            { activityLevel: 1, endGMT: '2026-09-21T22:00:00.0', startGMT: '2026-09-21T21:00:00.0' },
          ],
        }),
      ],
    )

    await repairGarminSleepStages(getTestDbClient())
    const after = await sleepData()

    for (const date of ['2026-09-23', '2026-09-24', '2026-09-25']) {
      expect(after[`garmin-sleep-${date}`]).toEqual({ ...garmin, ...hcPayload(date) })
    }
    const oldest = after['garmin-sleep-2026-09-22']
    expect(oldest).not.toHaveProperty('metadata')
    expect(oldest).not.toHaveProperty('startTime')
    expect(oldest).not.toHaveProperty('endTime')
    expect(oldest).toEqual({
      ...garmin,
      stages: [
        { endTime: '2026-09-21T22:00:00.000Z', stage: 4, startTime: '2026-09-21T21:00:00.000Z' },
        { endTime: '2026-09-21T23:00:00.000Z', stage: 5, startTime: '2026-09-21T22:00:00.000Z' },
      ],
    })

    await repairGarminSleepStages(getTestDbClient())
    expect(await sleepData()).toEqual(after)
  })

  test('strips a misfiled payload whose own night has no row', async () => {
    await insertSleep('2026-09-24', { sleep_score: 70, ...hcPayload('2026-09-25') })

    await repairGarminSleepStages(getTestDbClient())

    expect((await sleepData())['garmin-sleep-2026-09-24']).toEqual({ sleep_score: 70 })
  })

  test('leaves a correctly filed payload alone', async () => {
    const data = { sleep_score: 70, ...hcPayload('2026-09-24') }
    await insertSleep('2026-09-24', data)

    await repairGarminSleepStages(getTestDbClient())

    expect((await sleepData())['garmin-sleep-2026-09-24']).toEqual(data)
  })
})
