import { type JournalContextItem, journalContextItemSchema } from '@aurboda/api-spec'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { insertActivity, insertTimeSeries, upsertUserSettings } from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  defaultJournalContextDeps,
  getJournalContext,
  journalTrainingLoadDeps,
  trainingLoadAt,
} from './journal-context.ts'

const CONTAINER_TIMEOUT = 120_000

const scope = (user: string) => ({ customMetrics: [], day: '2024-03-10', tz: 'UTC', user })

const metricItem = (raw: Record<string, unknown>) =>
  journalContextItemSchema.parse({ id: 'x', kind: 'metric', label: 'X', ...raw }) as Extract<
    JournalContextItem,
    { kind: 'metric' }
  >

describe('journal context (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('metric value', () => {
    test("is the day's average, restricted to the source when given", async () => {
      const user = getTestUser()
      await insertTimeSeries(user, [
        { metric: 'readiness_score', source: 'oura', time: new Date('2024-03-10T06:00:00Z'), value: 85 },
        { metric: 'readiness_score', source: 'garmin', time: new Date('2024-03-10T07:00:00Z'), value: 65 },
      ])
      const value = (raw: Record<string, unknown>) =>
        defaultJournalContextDeps.metricValue(scope(user), metricItem(raw))

      expect(await value({ metric: 'readiness_score' })).toBe(75)
      expect(await value({ metric: 'readiness_score', source: 'oura' })).toBe(85)
      expect(await value({ metric: 'readiness_score', source: 'manual' })).toBeUndefined()
    })

    test("is the day's total for a summed metric", async () => {
      const user = getTestUser()
      await insertTimeSeries(user, [
        {
          metric: 'steps',
          source: 'health_connect_aggregate',
          time: new Date('2024-03-10T10:00:00Z'),
          value: 4000,
        },
        {
          metric: 'steps',
          source: 'health_connect_aggregate',
          time: new Date('2024-03-10T18:00:00Z'),
          value: 3000,
        },
      ])
      expect(await defaultJournalContextDeps.metricValue(scope(user), metricItem({ metric: 'steps' }))).toBe(
        7000,
      )
    })

    test('carries the latest earlier day forward only when asked', async () => {
      const user = getTestUser()
      await insertTimeSeries(user, [
        { metric: 'weight', source: 'garmin', time: new Date('2024-03-05T07:00:00Z'), value: 96 },
        { metric: 'weight', source: 'garmin', time: new Date('2024-03-05T08:00:00Z'), value: 97 },
        { metric: 'weight', source: 'manual', time: new Date('2024-03-07T07:00:00Z'), value: 99 },
        { metric: 'weight', source: 'garmin', time: new Date('2024-03-12T07:00:00Z'), value: 95 },
      ])
      const value = (raw: Record<string, unknown>) =>
        defaultJournalContextDeps.metricValue(scope(user), metricItem({ metric: 'weight', ...raw }))

      expect(await value({})).toBeUndefined()
      expect(await value({ missing: 'carry_forward' })).toBe(99)
      expect(await value({ missing: 'carry_forward', source: 'garmin' })).toBe(96.5)
    })
  })

  describe('derived dashboard metrics', () => {
    const at = (day: string, hour = 6) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`)

    test('rhr_7day / rhr_30day are the mean of the daily values over the days ending on the day', async () => {
      const user = getTestUser()
      await insertTimeSeries(user, [
        { metric: 'resting_heart_rate', source: 'oura', time: at('2024-03-03'), value: 40 },
        { metric: 'resting_heart_rate', source: 'oura', time: at('2024-03-04'), value: 60 },
        { metric: 'resting_heart_rate', source: 'garmin', time: at('2024-03-05'), value: 70 },
        { metric: 'resting_heart_rate', source: 'oura', time: at('2024-03-10'), value: 50 },
        { metric: 'resting_heart_rate', source: 'oura', time: at('2024-03-11'), value: 100 },
      ])
      const value = (raw: Record<string, unknown>, day = '2024-03-10') =>
        defaultJournalContextDeps.metricValue({ ...scope(user), day }, metricItem(raw))

      expect(await value({ metric: 'rhr_7day' })).toBe(60)
      expect(await value({ metric: 'rhr_30day' })).toBe(55)
      expect(await value({ metric: 'rhr_7day', source: 'garmin' })).toBe(70)
      expect(await value({ metric: 'rhr_7day' }, '2024-02-01')).toBeUndefined()
    })

    test('hrv_7day prefers the sleep HRV samples, as the dashboard card does', async () => {
      const user = getTestUser()
      await insertActivity(user, {
        activity_type: 'sleep',
        end_time: new Date('2024-03-09T06:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-03-08T22:00:00Z'),
      })
      await insertTimeSeries(user, [
        { metric: 'hrv_rmssd', source: 'oura', time: new Date('2024-03-09T02:00:00Z'), value: 60 },
        { metric: 'hrv_rmssd', source: 'oura', time: new Date('2024-03-09T03:00:00Z'), value: 70 },
        { metric: 'hrv_rmssd', source: 'garmin', time: at('2024-03-09', 14), value: 20 },
      ])
      const value = (raw: Record<string, unknown>) =>
        defaultJournalContextDeps.metricValue(scope(user), metricItem(raw))

      expect(await value({ metric: 'hrv_7day' })).toBe(65)
      expect(await value({ metric: 'hrv_7day', source: 'garmin' })).toBe(20)
      expect(
        await defaultJournalContextDeps.metricValue(
          { ...scope(user), day: '2024-03-09' },
          metricItem({ metric: 'hrv_sleep' }),
        ),
      ).toBe(65)
    })

    test('zone2_weekly is the zone-2 minutes over the 7 days ending on the day, from heart rate', async () => {
      const user = getTestUser()
      await upsertUserSettings(user, { hr_zone_start: { 1: 90, 2: 108, 3: 126, 4: 144, 5: 162 } })
      const minuteSamples = (from: string, values: number[]) =>
        values.map((value, i) => ({
          metric: 'heart_rate',
          source: 'garmin' as const,
          time: new Date(new Date(from).getTime() + i * 60_000),
          value,
        }))
      await insertTimeSeries(user, [
        ...minuteSamples('2024-03-03T10:00:00Z', [110, 110, 110]),
        ...minuteSamples('2024-03-05T10:00:00Z', [110, 110, 110]),
        ...minuteSamples('2024-03-10T10:00:00Z', [115, 115, 115, 130]),
        ...minuteSamples('2024-03-11T10:00:00Z', [110, 110, 110]),
      ])
      const value = (raw: Record<string, unknown>, day = '2024-03-10') =>
        defaultJournalContextDeps.metricValue({ ...scope(user), day }, metricItem(raw))

      expect(await value({ metric: 'zone2_weekly' })).toBe(6)
      expect(await value({ metric: 'zone2_weekly', source: 'oura' })).toBe(6)
      expect(await value({ metric: 'hr_zone_3_sec' })).toBe(60)
      expect(await value({ metric: 'zone2_weekly' }, '2024-02-01')).toBeUndefined()
    })

    test('the window follows the day in tz, not in UTC', async () => {
      const user = getTestUser()
      await insertTimeSeries(user, [
        // 2024-03-03 23:00 in Auckland (UTC+13): the day before the window
        { metric: 'resting_heart_rate', source: 'oura', time: new Date('2024-03-03T10:00:00Z'), value: 100 },
        // 2024-03-04 01:00 in Auckland: the window's first day
        { metric: 'resting_heart_rate', source: 'oura', time: new Date('2024-03-03T12:00:00Z'), value: 50 },
        // 2024-03-10 23:00 in Auckland: the window's last day
        { metric: 'resting_heart_rate', source: 'oura', time: new Date('2024-03-10T10:00:00Z'), value: 60 },
        // 2024-03-11 01:00 in Auckland: after the day
        { metric: 'resting_heart_rate', source: 'oura', time: new Date('2024-03-10T12:00:00Z'), value: 200 },
      ])
      expect(
        await defaultJournalContextDeps.metricValue(
          { ...scope(user), tz: 'Pacific/Auckland' },
          metricItem({ metric: 'rhr_7day' }),
        ),
      ).toBe(55)
    })
  })

  describe('training load', () => {
    const run = (user: string) =>
      insertActivity(user, {
        activity_type: 'running',
        end_time: new Date('2024-03-08T19:00:00Z'),
        source: 'manual',
        start_time: new Date('2024-03-08T18:00:00Z'),
      })

    test('is absent at once while the impulses are recomputed, then the load at the end of the day', async () => {
      const user = getTestUser()
      await run(user)
      const load = (day: string) => defaultJournalContextDeps.trainingLoadValue({ ...scope(user), day })

      const started = Date.now()
      expect(await load('2024-03-10')).toBeUndefined()
      expect(Date.now() - started).toBeLessThan(2000)
      await journalTrainingLoadDeps.recomputing.get(user)

      const after = await load('2024-03-10')
      expect(after?.ctl).toBeGreaterThan(0)
      expect(after?.atl).toBeGreaterThan(after?.ctl ?? Infinity)
      expect(after?.tsb).toBeCloseTo((after?.ctl ?? 0) - (after?.atl ?? 0), 6)
      expect(await load('2024-03-01')).toBeUndefined()
    })

    test('is absent for a day in the future', async () => {
      const user = getTestUser()
      await run(user)
      await trainingLoadAt(journalTrainingLoadDeps, user, '2024-03-10', 'UTC')
      await journalTrainingLoadDeps.recomputing.get(user)
      const future = Temporal.Now.plainDateISO('UTC').add({ days: 2 }).toString()
      expect(await trainingLoadAt(journalTrainingLoadDeps, user, future, 'UTC')).toBeUndefined()
    })
  })

  test('getJournalContext reads the setting and computes every kind for the day', async () => {
    const user = getTestUser()
    await upsertUserSettings(user, {
      journal_context: [
        { decimals: 0, id: 'r', kind: 'metric', label: 'ŌR', metric: 'readiness_score', missing: 'hide' },
        { decimals: 0, id: 'w', kind: 'metric', label: 'W', metric: 'weight', missing: 'hide' },
        {
          decimals: 0,
          id: 'e',
          kind: 'days_since',
          label: 'E',
          pattern: 'meditation',
          source_type: 'tag',
          unit: 'days',
        },
        {
          decimals: 1,
          id: 't',
          kind: 'trend',
          label: 'S',
          pattern: 'meditation',
          source_type: 'activity_type',
        },
        { decimals: 0, id: 'm', kind: 'moon', label: '', value: 'illumination' },
      ],
    })
    await insertTimeSeries(user, [
      { metric: 'readiness_score', source: 'oura', time: new Date('2024-03-10T06:00:00Z'), value: 85 },
    ])
    await insertActivity(user, {
      activity_type: 'meditation',
      source: 'manual',
      start_time: new Date('2024-03-08T18:00:00Z'),
    })

    const context = await getJournalContext(user, '2024-03-10', 'UTC')

    expect(context?.date).toBe('2024-03-10')
    expect(context?.items.map((v) => v.id)).toEqual(['r', 'e', 't', 'm'])
    expect(context?.items.find((v) => v.id === 'e')?.text).toBe('E2')
    expect(context?.items.find((v) => v.id === 't')?.value).toBeGreaterThan(0)
  })

  test('getJournalContext is undefined without configured items', async () => {
    expect(await getJournalContext(getTestUser(), '2024-03-10', 'UTC')).toBeUndefined()
  })
})
