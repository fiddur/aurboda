import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { GARMIN_HC_ORIGIN } from '../services/source-identity.ts'
import { cleanTestDb, getTestDbClient, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { repairGarminSleepStages } from './repair-garmin-sleep-stages.ts'
import { repairGarminSleepTimes } from './repair-garmin-sleep-times.ts'

const CONTAINER_TIMEOUT = 120_000

const prevDay = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

/** The night ending on `date` for a +02:00 sleeper. */
const nightStart = (date: string): string => `${prevDay(date)}T21:00:00.000Z`
const nightEnd = (date: string): string => `${date}T05:00:00.000Z`

/** The HC payload the Android app uploads for the night ending on `date` (UTC `Z` timestamps). */
const hcPayload = (date: string, notes?: string) => ({
  endTime: nightEnd(date),
  metadata: {
    clientRecordId: String(Date.parse(`${date}T00:00:00+02:00`)),
    dataOrigin: GARMIN_HC_ORIGIN,
    id: `hc-${date}`,
  },
  ...(notes ? { notes } : {}),
  stages: [{ endTime: nightEnd(date), stage: 4, startTime: nightStart(date) }],
  startTime: nightStart(date),
})

/** A Garmin sleep row for `date` whose span is the night ending on `spanDate`. */
const insertSleep = async (
  date: string,
  spanDate: string,
  data: Record<string, unknown>,
): Promise<string> => {
  const { rows } = await getTestDbClient().query<{ id: string }>(
    `INSERT INTO activities (source, external_id, activity_type, start_time, end_time, data)
     VALUES ('garmin', $1, 'sleep', $2, $3, $4) RETURNING id`,
    [`garmin-sleep-${date}`, nightStart(spanDate), nightEnd(spanDate), JSON.stringify(data)],
  )
  return rows[0].id
}

const insertGarminRaw = async (date: string, startIso = nightStart(date)): Promise<void> => {
  await getTestDbClient().query(
    `INSERT INTO raw_records (source, record_type, external_id, recorded_at, data)
     VALUES ('garmin', 'garmin_sleep', $1, $2, $3)`,
    [
      `garmin-sleep-${date}`,
      `${date}T00:00:00Z`,
      JSON.stringify({
        dailySleepDTO: {
          calendarDate: date,
          sleepEndTimestampGMT: Date.parse(nightEnd(date)),
          sleepStartTimestampGMT: Date.parse(startIso),
        },
      }),
    ],
  )
}

const insertHcNote = async (activityId: string, nightDate: string, content: string): Promise<string> => {
  const { rows } = await getTestDbClient().query<{ id: string }>(
    `INSERT INTO notes (entity_type, entity_id, content, source, start_time, end_time)
     VALUES ('activity', $1, $2, 'health_connect', $3, $4) RETURNING id`,
    [activityId, content, nightStart(nightDate), nightEnd(nightDate)],
  )
  return rows[0].id
}

const sleepSpans = async (): Promise<Record<string, [string, string]>> => {
  const { rows } = await getTestDbClient().query<{ external_id: string; start_time: Date; end_time: Date }>(
    `SELECT external_id, start_time, end_time FROM activities WHERE source = 'garmin' ORDER BY external_id`,
  )
  return Object.fromEntries(
    rows.map((r) => [r.external_id, [r.start_time.toISOString(), r.end_time.toISOString()]]),
  )
}

const notesState = async (): Promise<
  { id: string; entity_type: string; entity_id: string; content: string }[]
> =>
  (
    await getTestDbClient().query<{ id: string; entity_type: string; entity_id: string; content: string }>(
      `SELECT id, entity_type, entity_id, content FROM notes ORDER BY content`,
    )
  ).rows

describe('repairGarminSleepTimes integration', () => {
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
    expect(await repairGarminSleepTimes(getTestDbClient())).toEqual({ notes: 0, rows: 0 })
  })

  test('puts back the times and synced notes a misfiled HC upload left on the neighbouring night', async () => {
    const garmin = { sleep_score: 80 }
    const ids = {
      '2026-09-22': await insertSleep('2026-09-22', '2026-09-23', {
        ...garmin,
        ...hcPayload('2026-09-23', 'n23'),
      }),
      '2026-09-23': await insertSleep('2026-09-23', '2026-09-24', {
        ...garmin,
        ...hcPayload('2026-09-24', 'n24'),
      }),
      '2026-09-24': await insertSleep('2026-09-24', '2026-09-25', {
        ...garmin,
        ...hcPayload('2026-09-25', 'n25'),
      }),
      '2026-09-25': await insertSleep('2026-09-25', '2026-09-25', garmin),
    }
    for (const date of ['2026-09-22', '2026-09-23', '2026-09-24']) await insertGarminRaw(date)
    await insertGarminRaw('2026-09-25', '2026-09-24T21:05:00.000Z')

    await insertHcNote(ids['2026-09-22'], '2026-09-23', 'n23')
    await insertHcNote(ids['2026-09-23'], '2026-09-24', 'n24')
    const stale = await insertHcNote(ids['2026-09-24'], '2026-09-25', 'n25 stale')
    const fresh = await insertHcNote(ids['2026-09-25'], '2026-09-25', 'n25 fresh')
    await getTestDbClient().query(
      `INSERT INTO notes (entity_type, entity_id, content) VALUES ('note', $1, 'reply')`,
      [stale],
    )

    await repairGarminSleepStages(getTestDbClient())
    expect(await repairGarminSleepTimes(getTestDbClient())).toEqual({ notes: 3, rows: 3 })

    expect(await sleepSpans()).toEqual({
      'garmin-sleep-2026-09-22': [nightStart('2026-09-22'), nightEnd('2026-09-22')],
      'garmin-sleep-2026-09-23': [nightStart('2026-09-23'), nightEnd('2026-09-23')],
      'garmin-sleep-2026-09-24': [nightStart('2026-09-24'), nightEnd('2026-09-24')],
      'garmin-sleep-2026-09-25': [nightStart('2026-09-25'), nightEnd('2026-09-25')],
    })
    const notes = await notesState()
    expect(notes.map(({ content, entity_id, entity_type }) => ({ content, entity_id, entity_type }))).toEqual(
      [
        { content: 'n23', entity_id: ids['2026-09-23'], entity_type: 'activity' },
        { content: 'n24', entity_id: ids['2026-09-24'], entity_type: 'activity' },
        { content: 'n25 fresh', entity_id: ids['2026-09-25'], entity_type: 'activity' },
        { content: 'reply', entity_id: fresh, entity_type: 'note' },
      ],
    )

    const spans = await sleepSpans()
    expect(await repairGarminSleepTimes(getTestDbClient())).toEqual({ notes: 0, rows: 0 })
    expect(await sleepSpans()).toEqual(spans)
    expect(await notesState()).toEqual(notes)
  })
})
