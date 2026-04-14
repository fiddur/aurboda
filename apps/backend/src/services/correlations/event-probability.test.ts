import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { getEventProbability } from './event-probability.ts'

// Mock db module
vi.mock('../../db', () => ({
  getAllActivitiesInRange: vi.fn(),
}))

describe('getEventProbability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('calculates probability of outcome after trigger', async () => {
    const day1 = new Date('2024-01-01T10:00:00Z')
    const day1Later = new Date('2024-01-01T18:00:00Z')
    const day2 = new Date('2024-01-02T10:00:00Z')

    vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
      // Trigger events (gym)
      { external_id: 't1', source: 'manual' as const, start_time: day1, activity_type: 'gym' },
      { external_id: 't2', source: 'manual' as const, start_time: day2, activity_type: 'gym' },
      // Outcome events (headache)
      { external_id: 'o1', source: 'manual' as const, start_time: day1Later, activity_type: 'headache' },
    ])

    const result = await getEventProbability(
      'testuser',
      { type: 'tag', value: 'gym' },
      { pattern: 'headache', type: 'tag' },
      ['12h', '24h'],
      365,
    )

    expect(result.trigger.type).toBe('tag')
    expect(result.trigger.value).toBe('gym')
    expect(result.outcome.pattern).toBe('headache')
    expect(result.sample_size.trigger_events).toBe(2)
    expect(result.sample_size.outcome_events).toBe(1)
    expect(result.post_trigger['12h']).toBeDefined()
    expect(result.post_trigger['24h']).toBeDefined()
    expect(result.baseline.probability).toBeGreaterThanOrEqual(0)
  })

  test('handles activity triggers', async () => {
    const day1 = new Date('2024-01-01T10:00:00Z')
    const day1End = new Date('2024-01-01T11:00:00Z')
    const day1Later = new Date('2024-01-01T18:00:00Z')

    vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: day1End,
        id: 'a1',
        source: 'health_connect' as const,
        start_time: day1,
      },
      { activity_type: 'headache', external_id: 'o1', source: 'manual' as const, start_time: day1Later },
    ])

    const result = await getEventProbability(
      'testuser',
      { type: 'activity', value: 'exercise' },
      { pattern: 'headache', type: 'tag' },
      ['24h'],
      30,
    )

    expect(result.trigger.type).toBe('activity')
    expect(result.sample_size.trigger_events).toBe(1)
  })

  test('returns zero probability when no outcomes', async () => {
    const day1 = new Date('2024-01-01T10:00:00Z')

    vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
      { external_id: 't1', source: 'manual' as const, start_time: day1, activity_type: 'gym' },
    ])

    const result = await getEventProbability(
      'testuser',
      { type: 'tag', value: 'gym' },
      { pattern: 'headache', type: 'tag' },
    )

    expect(result.sample_size.outcome_events).toBe(0)
    expect(result.baseline.probability).toBe(0)
  })
})
