import { type JournalContextItem, journalContextItemSchema } from '@aurboda/api-spec'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { insertActivity, insertTimeSeries, upsertUserSettings } from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { defaultJournalContextDeps, getJournalContext } from './journal-context.ts'

const CONTAINER_TIMEOUT = 120_000

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
        defaultJournalContextDeps.metricValue(user, metricItem(raw), '2024-03-10', 'UTC')

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
      expect(
        await defaultJournalContextDeps.metricValue(
          user,
          metricItem({ metric: 'steps' }),
          '2024-03-10',
          'UTC',
        ),
      ).toBe(7000)
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
        defaultJournalContextDeps.metricValue(
          user,
          metricItem({ metric: 'weight', ...raw }),
          '2024-03-10',
          'UTC',
        )

      expect(await value({})).toBeUndefined()
      expect(await value({ missing: 'carry_forward' })).toBe(99)
      expect(await value({ missing: 'carry_forward', source: 'garmin' })).toBe(96.5)
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
