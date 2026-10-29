import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type * as TimeSeries from '../db/time-series.ts'
import type { MergedActivity } from '../db/types.ts'

import * as db from '../db/index.ts'
import * as measureSeries from './queries/activity-measure-series.ts'
import { decayedBestAt, decayingBestHistory, getTrend } from './trends.ts'

vi.mock('../db', async () => ({
  getSourceFilter: (await vi.importActual<typeof TimeSeries>('../db/time-series.ts')).getSourceFilter,
  query: vi.fn(),
}))

vi.mock('./queries/activity-measure-series', async (importOriginal) => ({
  ...(await importOriginal<typeof measureSeries>()),
  queryMeasuredActivities: vi.fn(),
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

describe('decayedBestAt', () => {
  test('is undefined without earlier points', () => {
    expect(decayedBestAt([], '2026-01-05', 2)).toBeUndefined()
    expect(decayedBestAt([{ day: '2026-01-05', value: 100 }], '2026-01-05', 2)).toBeUndefined()
  })

  test('halves a single point after one half-life', () => {
    expect(decayedBestAt([{ day: '2026-01-01', value: 100 }], '2026-01-03', 2)).toBe(50)
  })

  test('a weaker later point carries the decayed best, and a day keeps its best point', () => {
    const points = [
      { day: '2026-01-01', value: 80 },
      { day: '2026-01-01', value: 100 },
      { day: '2026-01-03', value: 40 },
    ]
    expect(decayedBestAt(points, '2026-01-05', 2)).toBeCloseTo(25)
  })

  test("agrees with decayingBestHistory's value on that day", () => {
    const points = [
      { day: '2026-01-01', value: 100 },
      { day: '2026-01-02', value: 90 },
      { day: '2026-01-04', value: 60 },
    ]
    const days = [
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
    ]
    const history = decayingBestHistory(points, days, 3, 0)
    expect(Math.round(decayedBestAt(points, '2026-01-07', 3)! * 10) / 10).toBe(history.at(-1)!.value)
  })
})

describe('decayingBestHistory', () => {
  const days = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05']

  test('a single session starts the line at its value, then halves every half-life', () => {
    expect(decayingBestHistory([{ day: '2026-01-02', value: 100 }], days, 2, 0)).toEqual([
      { date: '2026-01-02', value: 100 },
      { date: '2026-01-03', value: 70.7 },
      { date: '2026-01-04', value: 50 },
      { date: '2026-01-05', value: 35.4 },
    ])
  })

  test('a weaker later session carries the decayed best', () => {
    const history = decayingBestHistory(
      [
        { day: '2026-01-01', value: 100 },
        { day: '2026-01-03', value: 40 },
      ],
      days,
      2,
      0,
    )

    expect(history.find((p) => p.date === '2026-01-03')?.value).toBe(50)
  })

  test('a stronger later session lifts the best, which then decays from there', () => {
    const history = decayingBestHistory(
      [
        { day: '2026-01-01', value: 100 },
        { day: '2026-01-03', value: 60 },
      ],
      days,
      2,
      0,
    )

    expect(history.slice(2)).toEqual([
      { date: '2026-01-03', value: 60 },
      { date: '2026-01-04', value: 42.4 },
      { date: '2026-01-05', value: 30 },
    ])
  })

  test('the best session of a day counts', () => {
    const history = decayingBestHistory(
      [
        { day: '2026-01-01', value: 80 },
        { day: '2026-01-01', value: 90 },
      ],
      days,
      2,
      0,
    )

    expect(history[0]).toEqual({ date: '2026-01-01', value: 90 })
  })

  test('a warm-up session carries into the display range without its own point', () => {
    expect(decayingBestHistory([{ day: '2026-01-01', value: 100 }], days, 2, 2)).toEqual([
      { date: '2026-01-03', value: 50 },
      { date: '2026-01-04', value: 35.4 },
      { date: '2026-01-05', value: 25 },
    ])
  })

  test('no sessions, no points', () => {
    expect(decayingBestHistory([], days, 2, 0)).toEqual([])
  })
})

describe('getTrend measure trend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-02T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const measured = (startIso: string, measures: Record<string, number>): measureSeries.MeasuredActivity => ({
    activity: { activity_type: 'strength_training', start_time: new Date(startIso) } as MergedActivity,
    id: startIso,
    measures,
  })

  test('the decaying best of the measure, fetched from the warm-up start with the item filter', async () => {
    vi.mocked(measureSeries.queryMeasuredActivities).mockResolvedValue([
      measured('2026-01-21T17:00:00Z', { e1rm: 100 }),
      measured('2026-01-28T17:00:00Z', { volume: 3000 }),
      measured('2026-01-31T17:00:00Z', { e1rm: 40 }),
    ])

    const result = await getTrend('u', {
      filter_field: 'sets.exercise',
      filter_value: 'Squat',
      half_life_days: 10,
      lookback_days: 5,
      measure: 'e1rm',
      pattern: 'strength_training',
      source_type: 'activity_type',
    })

    expect(measureSeries.queryMeasuredActivities).toHaveBeenCalledWith(
      'u',
      'strength_training',
      new Date('2025-12-29T00:00:00Z'),
      new Date('2026-02-02T12:00:00Z'),
      { field: 'sets.exercise', value: 'Squat' },
    )
    expect(db.query).not.toHaveBeenCalled()
    expect(result).toEqual({
      aggregation: 'max',
      current_value: 43.5,
      display_period: 'monthly',
      display_unit: 'kg',
      filter_field: 'sets.exercise',
      filter_value: 'Squat',
      half_life_days: 10,
      history: [
        { date: '2026-01-28', value: 61.6 },
        { date: '2026-01-29', value: 57.4 },
        { date: '2026-01-30', value: 53.6 },
        { date: '2026-01-31', value: 50 },
        { date: '2026-02-01', value: 46.7 },
        { date: '2026-02-02', value: 43.5 },
      ],
      lookback_days: 5,
      measure: 'e1rm',
      pattern: 'strength_training',
      source_type: 'activity_type',
    })
  })
})
