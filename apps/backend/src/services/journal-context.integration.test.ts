import { type JournalContextItem, journalContextItemSchema } from '@aurboda/api-spec'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import {
  insertActivity,
  insertActivityTypeDefinition,
  insertTimeSeries,
  upsertUserSettings,
} from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { dayEndInTz, shiftDayKey } from './day-keys.ts'
import {
  clusterDays,
  defaultJournalContextDeps,
  getJournalContext,
  journalTrainingLoadDeps,
  trainingLoadAt,
  withJournalContext,
  withJournalContexts,
} from './journal-context.ts'
import { addNote, getNoteForUser, searchNotesForUser } from './mutations.ts'
import { getTrend } from './trends.ts'

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

      await load('2024-03-10')
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
        { decimals: 0, id: 'x', kind: 'weather', label: '', show_temperature: true },
      ],
    })
    await insertTimeSeries(user, [
      { metric: 'readiness_score', source: 'oura', time: new Date('2024-03-10T06:00:00Z'), value: 85 },
      { metric: 'weather_code', source: 'open_meteo', time: new Date('2024-03-10T12:00:00Z'), value: 0 },
      {
        metric: 'weather_temperature',
        source: 'open_meteo',
        time: new Date('2024-03-10T12:00:00Z'),
        value: 5.4,
      },
      { metric: 'weather_code', source: 'open_meteo', time: new Date('2024-03-10T15:00:00Z'), value: 3 },
      {
        metric: 'weather_temperature',
        source: 'open_meteo',
        time: new Date('2024-03-10T15:00:00Z'),
        value: 1.2,
      },
    ])
    await insertActivity(user, {
      activity_type: 'meditation',
      source: 'manual',
      start_time: new Date('2024-03-08T18:00:00Z'),
    })

    const context = await getJournalContext(user, '2024-03-10', 'UTC')

    expect(context?.date).toBe('2024-03-10')
    expect(context?.items.map((v) => v.id)).toEqual(['r', 'e', 't', 'm', 'x'])
    expect(context?.items.find((v) => v.id === 'e')?.text).toBe('E2')
    expect(context?.items.find((v) => v.id === 't')?.value).toBeGreaterThan(0)
    expect(context?.items.find((v) => v.id === 'x')?.text).toMatch(/^.+ 1–5 °C$/)

    const timed = await getJournalContext(user, '2024-03-10', 'UTC', undefined, '2024-03-10T12:30:00.000Z')
    expect(timed?.items.find((v) => v.id === 'x')?.text).toBe('☀️ 5 °C')
  })

  test("a listed entry's context equals the one get_note gives it", async () => {
    const user = getTestUser()
    await upsertUserSettings(user, {
      journal_context: [
        { decimals: 0, id: 'r', kind: 'metric', label: 'ŌR', metric: 'readiness_score', missing: 'hide' },
        { decimals: 0, id: 'm', kind: 'moon', label: '', value: 'illumination' },
        { decimals: 0, id: 'x', kind: 'weather', label: '', show_temperature: true },
      ],
    })
    await insertTimeSeries(user, [
      { metric: 'readiness_score', source: 'oura', time: new Date('2024-03-10T06:00:00Z'), value: 85 },
      { metric: 'weather_code', source: 'open_meteo', time: new Date('2024-03-10T12:00:00Z'), value: 0 },
      {
        metric: 'weather_temperature',
        source: 'open_meteo',
        time: new Date('2024-03-10T12:00:00Z'),
        value: 5.4,
      },
      { metric: 'weather_code', source: 'open_meteo', time: new Date('2024-03-10T17:00:00Z'), value: 3 },
      {
        metric: 'weather_temperature',
        source: 'open_meteo',
        time: new Date('2024-03-10T17:00:00Z'),
        value: 1.2,
      },
    ])
    const timed = await addNote(user, {
      content: 'Lunch walk',
      entity_type: 'time',
      start_time: '2024-03-10T12:30:00.000Z',
    })
    const evening = await addNote(user, {
      content: 'Evening',
      entity_type: 'time',
      start_time: '2024-03-10T17:15:00.000Z',
    })
    const day = await addNote(user, { content: 'A good day', date: '2024-03-10', entity_type: 'day' })
    expect(timed.success && evening.success && day.success).toBe(true)

    const found = await searchNotesForUser(user, { tz: 'UTC' })
    if (!found.success) throw new Error(found.error)
    const listed = await withJournalContexts(user, found.data, 'UTC')

    const weatherOf = (id: string | undefined) =>
      listed.find((note) => note.id === id)?.context?.items.find((v) => v.id === 'x')?.text
    expect([weatherOf(timed.data?.id), weatherOf(evening.data?.id)]).toEqual(['☀️ 5 °C', '☁️ 1 °C'])

    for (const id of [timed.data?.id, evening.data?.id, day.data?.id]) {
      const single = await getNoteForUser(user, id!)
      const detail = single.data && (await withJournalContext(user, single.data, 'UTC'))
      expect(detail?.context?.items.length).toBeGreaterThan(0)
      expect(listed.find((note) => note.id === id)?.context).toEqual(detail?.context)
    }
  })

  test("a batched trend value is the day's own read, for every source, half-life and missing-day rule", async () => {
    const user = getTestUser()
    await insertActivityTypeDefinition(user, {
      display_category: 'other',
      display_name: 'Gathering',
      name: 'gathering',
    })
    await insertActivity(user, {
      activity_type: 'gathering',
      data: { exclude_from_baseline: true },
      end_time: new Date('2024-03-08T00:00:00Z'),
      source: 'manual',
      start_time: new Date('2024-03-05T00:00:00Z'),
    })
    for (let i = 0; i < 34; i++) {
      const day = shiftDayKey('2024-01-10', i * 3 + (i % 2))
      await insertActivity(user, {
        activity_type: 'meditation',
        end_time: new Date(`${day}T18:${String(20 + (i % 4) * 10).padStart(2, '0')}:00Z`),
        source: 'manual',
        start_time: new Date(`${day}T18:00:00Z`),
      })
    }
    const weights = Array.from({ length: 17 }, (_, i) => ({
      metric: 'weight',
      source: 'garmin' as const,
      time: new Date(`${shiftDayKey('2024-01-15', i * 4)}T07:00:00Z`),
      value: 90 + ((i * 7) % 5) - i * 0.1,
    }))
    const steps = Array.from({ length: 60 }, (_, i) => ({
      metric: 'steps',
      source: 'health_connect_aggregate' as const,
      time: new Date(`${shiftDayKey('2024-01-20', i * 2)}T12:00:00Z`),
      value: 3000 + ((i * 937) % 5000),
    }))
    await insertTimeSeries(user, [...weights, ...steps])
    expect(weights.at(-1)?.time.toISOString().slice(0, 10)).toBe('2024-03-19')

    const days = [
      '2024-01-05',
      '2024-02-01',
      '2024-02-25',
      '2024-03-20',
      '2024-04-15',
      '2024-05-10',
      '2024-06-08',
      '2024-06-17',
    ]
    expect(clusterDays(days)).toHaveLength(1)
    const trendScope = { customMetrics: [], tz: 'UTC', user }
    const single = async (trend: Extract<JournalContextItem, { kind: 'trend' }>, day: string) => {
      const result = await getTrend(user, {
        aggregation: trend.aggregation,
        display_period: trend.display_period,
        end: dayEndInTz(day, 'UTC'),
        exclude_flagged: true,
        half_life_days: trend.half_life_days,
        missing_days: trend.missing_days,
        pattern: trend.pattern,
        source_type: trend.source_type,
        tz: 'UTC',
      })
      return result.history.length === 0 ? undefined : result.current_value
    }
    const trend = (raw: Record<string, unknown>) =>
      journalContextItemSchema.parse({ id: 't', kind: 'trend', label: 'T', ...raw }) as Extract<
        JournalContextItem,
        { kind: 'trend' }
      >

    const compared: string[] = []
    for (const half_life_days of [7, 15, 30]) {
      for (const raw of [
        { aggregation: 'count', pattern: 'meditation', source_type: 'activity_type' },
        { aggregation: 'sum', display_period: 'weekly', pattern: 'meditation', source_type: 'activity_type' },
        { pattern: 'meditation', source_type: 'tag' },
        { pattern: 'weight', source_type: 'metric' },
        { missing_days: 'zero', pattern: 'weight', source_type: 'metric' },
        { display_period: 'daily', pattern: 'steps', source_type: 'metric' },
        { missing_days: 'skip', pattern: 'steps', source_type: 'metric' },
      ]) {
        const item = trend({ half_life_days, ...raw })
        const batched = await defaultJournalContextDeps.trendValues(trendScope, item, days)
        for (const day of days) {
          const label = `${JSON.stringify(raw)} h${half_life_days} ${day}`
          expect({ label, value: batched.get(day) }).toEqual({ label, value: await single(item, day) })
          compared.push(label)
        }
        expect(batched.has('2024-01-05')).toBe(false)
        expect(batched.has('2024-03-19') || batched.has('2024-03-20')).toBe(true)
        if (raw.pattern === 'weight' && raw.missing_days === undefined) {
          expect(batched.get('2024-06-17')).toBeDefined()
        }
      }
    }
    expect(compared).toHaveLength(3 * 7 * days.length)
  }, 300_000)

  test('getJournalContext is undefined without configured items', async () => {
    expect(await getJournalContext(getTestUser(), '2024-03-10', 'UTC')).toBeUndefined()
  })
})
