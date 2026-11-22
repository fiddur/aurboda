import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { OutcomeConfig, TriggerCondition } from './types.ts'

import * as db from '../../db/index.ts'
import { triggerConditionToSelector } from './explore.ts'
import { genericTriggersError, getGenericCorrelation } from './generic.ts'

vi.mock('../../db', () => ({
  getEffectiveActivitiesInRange: vi.fn(),
  getFlaggedWindows: vi.fn(),
  getProductivity: vi.fn(),
  getTimeSeries: vi.fn(),
  listActivityIntervalsWithPeople: vi.fn(),
}))

const ANNA = '11111111-1111-4111-8111-111111111111'
const interval = (from: string, to: string) => ({ end_time: new Date(to), start_time: new Date(from) })
const outcome: OutcomeConfig = { collapse_gap_days: 0, metric: 'headache', source: 'metric', type: 'event' }
const options = { periodEnd: '2024-01-05', periodStart: '2024-01-01' }

const triggerDays = async (trigger: TriggerCondition) =>
  (await getGenericCorrelation('user', [trigger], outcome, ['24h'], 90, undefined, options)).event_outcome
    ?.trigger_days

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(db.getTimeSeries).mockResolvedValue([[new Date('2024-01-03T08:00:00Z'), 1]])
  vi.mocked(db.listActivityIntervalsWithPeople).mockResolvedValue([])
})

describe('a people trigger in event mode', () => {
  test('the time with anyone makes every day with company a trigger day', async () => {
    vi.mocked(db.listActivityIntervalsWithPeople).mockResolvedValue([
      interval('2024-01-02T10:00:00Z', '2024-01-02T11:00:00Z'),
      interval('2024-01-04T18:00:00Z', '2024-01-04T18:30:00Z'),
    ])

    expect(await triggerDays({ type: 'people' })).toBe(2)
    expect(db.listActivityIntervalsWithPeople).toHaveBeenCalledWith(
      'user',
      expect.any(Date),
      expect.any(Date),
      undefined,
    )
  })

  test('one person asks for that person only', async () => {
    vi.mocked(db.listActivityIntervalsWithPeople).mockResolvedValue([
      interval('2024-01-02T10:00:00Z', '2024-01-02T11:00:00Z'),
    ])

    expect(await triggerDays({ person_id: ANNA, type: 'people' })).toBe(1)
    expect(db.listActivityIntervalsWithPeople).toHaveBeenCalledWith(
      'user',
      expect.any(Date),
      expect.any(Date),
      ANNA,
    )
  })

  test('a threshold in minutes counts overlapping activities once', async () => {
    vi.mocked(db.listActivityIntervalsWithPeople).mockResolvedValue([
      interval('2024-01-02T10:00:00Z', '2024-01-02T10:40:00Z'),
      interval('2024-01-02T10:20:00Z', '2024-01-02T11:00:00Z'),
      interval('2024-01-03T10:00:00Z', '2024-01-03T10:50:00Z'),
    ])

    expect(await triggerDays({ threshold: { op: 'gte', value: 60 }, type: 'people' })).toBe(1)
    expect(await triggerDays({ threshold: { op: 'gte', value: 70 }, type: 'people' })).toBe(0)
  })

  test('maps to the people selector', () => {
    const threshold = { op: 'gte' as const, value: 30 }
    expect(triggerConditionToSelector({ person_id: ANNA, threshold, type: 'people' })).toEqual({
      kind: 'people',
      person_id: ANNA,
      threshold,
    })
  })

  test('needs an event outcome', async () => {
    await expect(
      getGenericCorrelation('user', [{ type: 'people' }], { pattern: 'x', type: 'tag' }, ['24h'], 90),
    ).rejects.toThrow('People triggers are only supported with an "event" outcome')
  })
})

describe('genericTriggersError', () => {
  const live = vi.fn(async (_user: string, ids: string[] | undefined) =>
    ids?.some((id) => id !== ANNA) ? `Unknown people: ${ids.filter((id) => id !== ANNA).join(', ')}` : null,
  )
  const GONE = '22222222-2222-4222-8222-222222222222'

  test('names an unknown or deleted person', async () => {
    expect(await genericTriggersError('user', [{ person_id: GONE, type: 'people' }], outcome, live)).toBe(
      `Unknown people: ${GONE}`,
    )
  })

  test('accepts a live person and the time with anyone', async () => {
    expect(
      await genericTriggersError(
        'user',
        [{ person_id: ANNA, type: 'people' }, { type: 'people' }],
        outcome,
        live,
      ),
    ).toBeNull()
  })

  test('refuses a people trigger with an outcome that is not an event', async () => {
    expect(
      await genericTriggersError('user', [{ type: 'people' }], { pattern: 'x', type: 'tag' }, live),
    ).toBe('People triggers are only supported with an "event" outcome')
  })

  test('leaves other triggers alone', async () => {
    expect(
      await genericTriggersError(
        'user',
        [{ pattern: 'run', type: 'activity' }],
        { pattern: 'x', type: 'tag' },
        live,
      ),
    ).toBeNull()
    expect(live).not.toHaveBeenCalled()
  })
})
