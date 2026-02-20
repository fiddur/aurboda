import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as db from '../db'
import { getTrend } from './trends'

// Mock the db module
vi.mock('../db', () => ({
  query: vi.fn(),
}))

describe('getTrend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-02T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('returns trend data for tags with default parameters', async () => {
    // Mock query to return daily counts with EMA values
    vi.mocked(db.query).mockResolvedValue({
      rows: [
        { day: new Date('2026-01-01'), ema_value: 2.5 },
        { day: new Date('2026-01-08'), ema_value: 3.0 },
        { day: new Date('2026-01-15'), ema_value: 2.8 },
        { day: new Date('2026-02-02'), ema_value: 3.5 },
      ],
    } as never)

    const result = await getTrend('testuser', {
      pattern: 'pain_killer',
      source_type: 'tag',
    })

    expect(result.source_type).toBe('tag')
    expect(result.pattern).toBe('pain_killer')
    expect(result.aggregation).toBe('count')
    expect(result.display_period).toBe('monthly')
    expect(result.display_unit).toBe('per month')
    expect(result.half_life_days).toBe(15) // default
    expect(result.lookback_days).toBe(90) // default
    expect(result.current_value).toBe(3.5) // last value in history
    expect(result.history).toHaveLength(4)
  })

  test('uses custom half-life and lookback days', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [
        { day: new Date('2026-02-01'), ema_value: 1.5 },
        { day: new Date('2026-02-02'), ema_value: 2.0 },
      ],
    } as never)

    const result = await getTrend('testuser', {
      display_period: 'weekly',
      half_life_days: 7,
      lookback_days: 30,
      pattern: 'coffee',
      source_type: 'tag',
    })

    expect(result.half_life_days).toBe(7)
    expect(result.lookback_days).toBe(30)
    expect(result.display_period).toBe('weekly')
    expect(result.display_unit).toBe('per week')
  })

  test('returns trend data for metrics', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [
        { day: new Date('2026-01-15'), ema_value: 72.5 },
        { day: new Date('2026-02-01'), ema_value: 71.8 },
        { day: new Date('2026-02-02'), ema_value: 71.5 },
      ],
    } as never)

    const result = await getTrend('testuser', {
      aggregation: 'mean',
      pattern: 'weight',
      source_type: 'metric',
    })

    expect(result.source_type).toBe('metric')
    expect(result.pattern).toBe('weight')
    expect(result.aggregation).toBe('mean')
    expect(result.display_unit).toBe('') // No unit for mean aggregation
    expect(result.current_value).toBe(71.5)
  })

  test('throws error for invalid metric', async () => {
    await expect(
      getTrend('testuser', {
        pattern: 'invalid_metric_name',
        source_type: 'metric',
      }),
    ).rejects.toThrow('Invalid metric: invalid_metric_name')
  })

  test('handles empty data', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [],
    } as never)

    const result = await getTrend('testuser', {
      pattern: 'nonexistent_tag',
      source_type: 'tag',
    })

    expect(result.current_value).toBe(0)
    expect(result.history).toHaveLength(0)
  })

  test('formats history dates correctly', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [
        { day: new Date('2026-01-15T00:00:00Z'), ema_value: 5.0 },
        { day: new Date('2026-02-02T00:00:00Z'), ema_value: 4.5 },
      ],
    } as never)

    const result = await getTrend('testuser', {
      pattern: 'test_tag',
      source_type: 'tag',
    })

    expect(result.history[0].date).toBe('2026-01-15')
    expect(result.history[1].date).toBe('2026-02-02')
  })

  test('uses sum aggregation for metrics when specified', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ day: new Date('2026-02-02'), ema_value: 150.0 }],
    } as never)

    const result = await getTrend('testuser', {
      aggregation: 'sum',
      display_period: 'daily',
      pattern: 'steps',
      source_type: 'metric',
    })

    expect(result.aggregation).toBe('sum')
    expect(result.display_unit).toBe('per day')
  })
})
