import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type * as TimeSeries from '../db/time-series.ts'

import * as db from '../db/index.ts'
import { getTrend } from './trends.ts'

vi.mock('../db', async () => ({
  getSourceFilter: (await vi.importActual<typeof TimeSeries>('../db/time-series.ts')).getSourceFilter,
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
    expect(result.display_unit).toBe('kg')
    expect(result.current_value).toBe(71.5)
  })

  test('accepts custom metrics when provided', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [
        { day: new Date('2026-01-20'), ema_value: 3.5 },
        { day: new Date('2026-02-02'), ema_value: 2.1 },
      ],
    } as never)

    const result = await getTrend('testuser', {
      aggregation: 'mean',
      custom_metrics: [{ name: 'fissure_pain', unit: 'score' }],
      pattern: 'fissure_pain',
      source_type: 'metric',
    })

    expect(result.source_type).toBe('metric')
    expect(result.pattern).toBe('fissure_pain')
    expect(result.current_value).toBe(2.1)
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

  test('returns trend data for productivity_category', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [
        { day: new Date('2026-01-15'), ema_value: 2.3 },
        { day: new Date('2026-02-02'), ema_value: 3.1 },
      ],
    } as never)

    const result = await getTrend('testuser', {
      display_period: 'daily',
      pattern: 'Work > Programming',
      source_type: 'productivity_category',
    })

    expect(result.source_type).toBe('productivity_category')
    expect(result.pattern).toBe('Work > Programming')
    expect(result.aggregation).toBe('sum')
    expect(result.display_unit).toBe('hours per day')
    expect(result.current_value).toBe(3.1)
    expect(result.history).toHaveLength(2)

    const sql = vi.mocked(db.query).mock.calls[0][1] as string
    expect(sql).toContain('FROM activities')
    expect(sql).toContain("starts_with(data->>'category_path', $1 || ' > ')")
    expect(sql).not.toContain('FROM productivity')
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
    expect(result.display_unit).toBe('count per day')
  })

  describe('metric missing days', () => {
    const metricSql = () => vi.mocked(db.query).mock.calls[0][1] as string
    const ibuprofen = { aggregation: 'sum' as const, name: 'ibuprofen_mg', unit: 'mg' }

    beforeEach(() => {
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as never)
    })

    test('a level metric skips missing days by default', async () => {
      const result = await getTrend('testuser', {
        aggregation: 'mean',
        pattern: 'weight',
        source_type: 'metric',
      })

      expect(metricSql()).not.toContain('COALESCE(dv2.daily_value, 0)')
      expect(metricSql()).toContain('CASE WHEN dv2.daily_value IS NOT NULL')
      expect(result.missing_days).toBe('skip')
    })

    test('a built-in amount metric zero-fills missing days by default', async () => {
      const result = await getTrend('testuser', {
        aggregation: 'sum',
        pattern: 'steps',
        source_type: 'metric',
      })

      expect(metricSql()).toContain('COALESCE(dv2.daily_value, 0)')
      expect(metricSql()).not.toContain('CASE WHEN dv2.daily_value IS NOT NULL')
      expect(result.missing_days).toBe('zero')
    })

    test('a custom amount metric zero-fills missing days by default', async () => {
      const result = await getTrend('testuser', {
        aggregation: 'sum',
        custom_metrics: [ibuprofen],
        display_period: 'monthly',
        pattern: 'ibuprofen_mg',
        source_type: 'metric',
      })

      expect(metricSql()).toContain('COALESCE(dv2.daily_value, 0)')
      expect(result.missing_days).toBe('zero')
      expect(result.display_unit).toBe('mg per month')
    })

    test('a custom metric without a kind is a level metric', async () => {
      const result = await getTrend('testuser', {
        aggregation: 'sum',
        custom_metrics: [{ name: 'mood', unit: 'score' }],
        pattern: 'mood',
        source_type: 'metric',
      })

      expect(metricSql()).not.toContain('COALESCE(dv2.daily_value, 0)')
      expect(result.missing_days).toBe('skip')
    })

    test('missing_days overrides the metric kind', async () => {
      const zero = await getTrend('testuser', {
        aggregation: 'mean',
        missing_days: 'zero',
        pattern: 'weight',
        source_type: 'metric',
      })
      expect(metricSql()).toContain('COALESCE(dv2.daily_value, 0)')
      expect(zero.missing_days).toBe('zero')

      vi.mocked(db.query).mockClear()
      const skip = await getTrend('testuser', {
        aggregation: 'sum',
        custom_metrics: [ibuprofen],
        missing_days: 'skip',
        pattern: 'ibuprofen_mg',
        source_type: 'metric',
      })
      expect(metricSql()).not.toContain('COALESCE(dv2.daily_value, 0)')
      expect(skip.missing_days).toBe('skip')
    })

    test('count counts samples per day, always zero-filled', async () => {
      const result = await getTrend('testuser', {
        aggregation: 'count',
        display_period: 'weekly',
        missing_days: 'skip',
        pattern: 'weight',
        source_type: 'metric',
      })

      expect(metricSql()).toContain('COUNT(*)')
      expect(metricSql()).toContain('COALESCE(dv2.daily_value, 0)')
      expect(vi.mocked(db.query).mock.calls[0][2]?.[3]).toBe(7)
      expect(result.aggregation).toBe('count')
      expect(result.missing_days).toBe('zero')
      expect(result.display_unit).toBe('per week')
    })

    test('a metric trend without aggregation is a mean', async () => {
      const result = await getTrend('testuser', { pattern: 'weight', source_type: 'metric' })

      expect(metricSql()).toContain('AVG(value)')
      expect(result.aggregation).toBe('mean')
    })

    test('display_unit falls back when the unit is unknown', async () => {
      const sum = await getTrend('testuser', {
        aggregation: 'sum',
        pattern: 'unknown_metric',
        source_type: 'metric',
      })
      expect(sum.display_unit).toBe('per month')

      const mean = await getTrend('testuser', {
        aggregation: 'mean',
        pattern: 'unknown_metric',
        source_type: 'metric',
      })
      expect(mean.display_unit).toBe('')
    })

    test('activity type trends carry no missing_days', async () => {
      const result = await getTrend('testuser', {
        aggregation: 'sum',
        pattern: 'running',
        source_type: 'activity_type',
      })

      expect(result.missing_days).toBeUndefined()
    })
  })

  test('returns breakdown trend with per-series EMA histories', async () => {
    // Mock the breakdown query — returns daily values grouped by field
    vi.mocked(db.query).mockResolvedValue({
      rows: [
        { day: new Date('2026-01-30'), field_0: 'alice', value: 1 },
        { day: new Date('2026-01-30'), field_0: 'bob', value: 2 },
        { day: new Date('2026-02-01'), field_0: 'alice', value: 1 },
      ],
    } as never)

    const result = await getTrend('testuser', {
      breakdown_fields: ['partner'],
      pattern: 'sex',
      source_type: 'activity_type',
    })

    expect(result.breakdown_series).toEqual(['alice', 'bob'])
    expect(result.breakdown_histories).toBeDefined()
    expect(result.breakdown_histories!['alice'].length).toBeGreaterThan(0)
    expect(result.breakdown_histories!['bob'].length).toBeGreaterThan(0)
    expect(result.history).toHaveLength(0)
    expect(result.current_value).toBe(0)
  })

  test('returns empty breakdown for invalid field names', async () => {
    const result = await getTrend('testuser', {
      breakdown_fields: ['INVALID-FIELD'],
      pattern: 'sex',
      source_type: 'activity_type',
    })

    expect(result.breakdown_series).toEqual([])
    expect(result.breakdown_histories).toEqual({})
    expect(db.query).not.toHaveBeenCalled()
  })

  test('returns empty breakdown when no data matches', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as never)

    const result = await getTrend('testuser', {
      breakdown_fields: ['partner'],
      pattern: 'nonexistent',
      source_type: 'activity_type',
    })

    expect(result.breakdown_series).toEqual([])
    expect(result.breakdown_histories).toEqual({})
  })

  // Regression: activity-based trend queries must skip cross-source duplicates
  // (rows with superseded_by set) so a single physical activity synced from
  // multiple sources doesn't inflate the trend.
  describe('superseded_by filtering', () => {
    test('activity_type sum trend filters superseded rows', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as never)
      await getTrend('testuser', {
        aggregation: 'sum',
        pattern: 'running',
        source_type: 'activity_type',
      })
      const sql = vi.mocked(db.query).mock.calls[0][1] as string
      expect(sql).toContain('superseded_by IS NULL')
    })

    test('activity_type count trend filters superseded rows', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as never)
      await getTrend('testuser', {
        aggregation: 'count',
        pattern: 'coffee',
        source_type: 'tag',
      })
      const sql = vi.mocked(db.query).mock.calls[0][1] as string
      expect(sql).toContain('superseded_by IS NULL')
    })

    test('activity_type breakdown trend filters superseded rows', async () => {
      vi.mocked(db.query).mockResolvedValue({ rows: [] } as never)
      await getTrend('testuser', {
        aggregation: 'sum',
        breakdown_fields: ['partner'],
        pattern: 'running',
        source_type: 'activity_type',
      })
      const sql = vi.mocked(db.query).mock.calls[0][1] as string
      expect(sql).toContain('superseded_by IS NULL')
    })
  })
})
