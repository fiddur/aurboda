import type { ActivityTypeDefinition } from '@aurboda/api-spec'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as TimeSeriesModule from '../db/time-series.ts'
import type { MergedActivity } from '../db/types.ts'

import * as db from '../db/index.ts'
import { buildBucketExpr, getChartData } from './chart-data.ts'
import * as settings from './settings.ts'

// Mock the db module. getSourceFilter is pulled through real (pure function) so
// the cumulative-source rules can't drift from production.
vi.mock('../db', async () => ({
  expandActivityTypes: vi.fn().mockImplementation((_user: string, types: string[]) => Promise.resolve(types)),
  getActivities: vi.fn(),
  getActivityTypeDefinitions: vi.fn(),
  getBucketStarts: vi.fn(),
  getHrZoneSecs: vi.fn(),
  getSourceFilter: (await vi.importActual<typeof TimeSeriesModule>('../db/time-series.ts')).getSourceFilter,
  getUserSettings: vi.fn().mockResolvedValue(null),
  query: vi.fn(),
}))

vi.mock('./settings', async () => ({
  ...(await vi.importActual<typeof settings>('./settings.ts')),
  getEffectiveHrZones: vi.fn(),
}))

describe('getChartData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns bucketed activity counts by activity type name', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [
        { bucket_start: new Date('2026-01-01T00:00:00Z'), value: 3n },
        { bucket_start: new Date('2026-01-02T00:00:00Z'), value: 5n },
      ],
    } as never)

    const result = await getChartData('testuser', {
      aggregation: 'count',
      bucket_size: '1d',
      end: '2026-01-31T23:59:59Z',
      source_type: 'tag',
      start: '2026-01-01T00:00:00Z',
      tag_definition_id: '550e8400-e29b-41d4-a716-446655440000',
    })

    expect(result.buckets).toHaveLength(2)
    expect(result.buckets[0].bucket_start).toBe('2026-01-01T00:00:00.000Z')
    expect((result.buckets[0] as { value: number }).value).toBe(3)
    expect((result.buckets[1] as { value: number }).value).toBe(5)

    // Verify the SQL uses date_trunc with 'day'
    const call = vi.mocked(db.query).mock.calls[0]
    expect(call[2]![0]).toBe('day')
  })

  test('returns bucketed activity counts by pattern', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ bucket_start: new Date('2026-01-06T00:00:00Z'), value: 7n }],
    } as never)

    const result = await getChartData('testuser', {
      aggregation: 'count',
      bucket_size: '1w',
      end: '2026-01-31T23:59:59Z',
      pattern: 'coffee',
      source_type: 'tag',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result.buckets).toHaveLength(1)
    expect((result.buckets[0] as { value: number }).value).toBe(7)

    // Verify the SQL uses date_trunc with 'week'
    const call = vi.mocked(db.query).mock.calls[0]
    expect(call[2]![0]).toBe('week')
  })

  test('returns empty buckets for tag source without pattern or tag_definition_id', async () => {
    const result = await getChartData('testuser', {
      aggregation: 'count',
      bucket_size: '1d',
      end: '2026-01-31T23:59:59Z',
      source_type: 'tag',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result.buckets).toEqual([])
    expect(db.query).not.toHaveBeenCalled()
  })

  test('returns bucketed metric data with mean aggregation', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [
        { bucket_start: new Date('2026-01-01T00:00:00Z'), value: 72.5 },
        { bucket_start: new Date('2026-02-01T00:00:00Z'), value: 71.8 },
      ],
    } as never)

    const result = await getChartData('testuser', {
      aggregation: 'mean',
      bucket_size: '1M',
      end: '2026-02-28T23:59:59Z',
      pattern: 'weight',
      source_type: 'metric',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result.buckets).toHaveLength(2)
    expect((result.buckets[0] as { value: number }).value).toBe(72.5)

    // Verify the SQL uses date_trunc with 'month'
    const call = vi.mocked(db.query).mock.calls[0]
    expect(call[2]![0]).toBe('month')
    expect(call[1]).toContain('AVG(value)')
  })

  test('returns bucketed metric data with sum aggregation', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ bucket_start: new Date('2026-01-01T00:00:00Z'), value: 8500 }],
    } as never)

    const result = await getChartData('testuser', {
      aggregation: 'sum',
      bucket_size: '1d',
      end: '2026-01-31T23:59:59Z',
      pattern: 'steps',
      source_type: 'metric',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result.buckets).toHaveLength(1)
    expect((result.buckets[0] as { value: number }).value).toBe(8500)

    const call = vi.mocked(db.query).mock.calls[0]
    expect(call[1]).toContain('SUM(value)')
    // Cumulative metric (steps) must be restricted to trusted sources so it isn't
    // multiply-counted (raw + daily-aggregate + …). Regression guard for the
    // chart/challenge over-count.
    expect(call[1]).toContain('source = ANY')
    expect(call[1]).toContain('deleted_at IS NULL')
    expect(call[2]).toContainEqual(['health_connect_aggregate', 'aurboda'])
  })

  test('non-cumulative metric sum does not restrict sources', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ bucket_start: new Date('2026-01-01T00:00:00Z'), value: 5 }],
    } as never)

    await getChartData('testuser', {
      aggregation: 'sum',
      bucket_size: '1d',
      end: '2026-01-31T23:59:59Z',
      pattern: 'heart_rate',
      source_type: 'metric',
      start: '2026-01-01T00:00:00Z',
    })

    const call = vi.mocked(db.query).mock.calls[0]
    expect(call[1]).not.toContain('source = ANY')
  })

  test('charts hr_zone metrics by computing zone seconds per bucket', async () => {
    const zones = { 1: 90, 2: 110, 3: 130, 4: 150, 5: 170 }
    vi.mocked(db.getHrZoneSecs).mockResolvedValue([
      {
        bucket_start: new Date('2026-06-24T00:00:00Z'),
        sample_count: 2,
        secs: { 0: 0, 1: 0, 2: 120, 3: 0, 4: 0, 5: 0 },
      },
      {
        bucket_start: new Date('2026-06-25T00:00:00Z'),
        sample_count: 1,
        secs: { 0: 1, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      },
    ])
    vi.mocked(settings.getEffectiveHrZones).mockResolvedValue({ source: 'custom', zones })

    const result = await getChartData('testuser', {
      aggregation: 'sum',
      bucket_size: '1d',
      end: '2026-06-25T00:00:00Z',
      pattern: 'hr_zone_2_sec',
      source_type: 'metric',
      start: '2026-06-24T00:00:00Z',
    })

    // Computed from heart_rate with the user's zones (not the non-existent hr_zone_2_sec rows), by day.
    expect(db.getHrZoneSecs).toHaveBeenCalledWith(
      'testuser',
      new Date('2026-06-24T00:00:00Z'),
      new Date('2026-06-25T00:00:00Z'),
      zones,
      '1d',
      'UTC',
    )
    expect(result.buckets).toEqual([
      { bucket_start: '2026-06-24T00:00:00.000Z', value: 120 },
      { bucket_start: '2026-06-25T00:00:00.000Z', value: 0 },
    ])
    // Plain metric query path is not used for zone metrics.
    expect(vi.mocked(db.query)).not.toHaveBeenCalled()
  })

  test('passes tz to hr_zone bucketing', async () => {
    vi.mocked(db.getHrZoneSecs).mockResolvedValue([])
    vi.mocked(settings.getEffectiveHrZones).mockResolvedValue({
      source: 'default',
      zones: { 1: 90, 2: 110, 3: 130, 4: 150, 5: 170 },
    })

    await getChartData('testuser', {
      aggregation: 'sum',
      bucket_size: '1d',
      end: '2026-06-25T00:00:00Z',
      pattern: 'hr_zone_1_sec',
      source_type: 'metric',
      start: '2026-06-01T00:00:00Z',
      tz: 'Europe/Stockholm',
    })

    expect(vi.mocked(db.getHrZoneSecs).mock.calls[0][5]).toBe('Europe/Stockholm')
  })

  test.each([
    ['tag', { pattern: 'coffee' }],
    ['tag', { tag_definition_id: '550e8400-e29b-41d4-a716-446655440000' }],
    ['metric', { pattern: 'weight' }],
    ['productivity_category', { pattern: 'Work' }],
    ['activity_type', { pattern: 'run' }],
    ['activity_type', { breakdown_fields: ['device'], pattern: 'run' }],
  ] as const)('%s query binds tz as a parameter (%o)', async (source_type, extra) => {
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as never)

    await getChartData('testuser', {
      aggregation: 'sum',
      bucket_size: '1w',
      end: '2026-01-31T23:59:59Z',
      source_type,
      start: '2026-01-01T00:00:00Z',
      tz: 'Europe/Stockholm',
      ...extra,
      breakdown_fields: 'breakdown_fields' in extra ? [...extra.breakdown_fields] : undefined,
    })

    const [, sql, params] = vi.mocked(db.query).mock.calls[0]
    expect(sql).toContain('date_trunc($1::text, ')
    expect(sql).not.toContain('Europe/Stockholm')
    expect(params!.slice(0, 2)).toEqual(['week', 'Europe/Stockholm'])
  })

  test('zone2_weekly aliases to hr_zone_2_sec (computed, not queried)', async () => {
    vi.mocked(db.getHrZoneSecs).mockResolvedValue([])
    vi.mocked(settings.getEffectiveHrZones).mockResolvedValue({
      source: 'default',
      zones: { 1: 90, 2: 110, 3: 130, 4: 150, 5: 170 },
    })

    await getChartData('testuser', {
      aggregation: 'sum',
      bucket_size: '1w',
      end: '2026-06-25T00:00:00Z',
      pattern: 'zone2_weekly',
      source_type: 'metric',
      start: '2026-06-01T00:00:00Z',
    })

    expect(vi.mocked(db.getHrZoneSecs).mock.calls[0][4]).toBe('1w')
    expect(vi.mocked(db.query)).not.toHaveBeenCalled()
  })

  test('returns bucketed metric data with count aggregation', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ bucket_start: new Date('2026-01-01T00:00:00Z'), value: 24n }],
    } as never)

    const result = await getChartData('testuser', {
      aggregation: 'count',
      bucket_size: '1d',
      end: '2026-01-31T23:59:59Z',
      pattern: 'heart_rate',
      source_type: 'metric',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result.buckets).toHaveLength(1)
    expect((result.buckets[0] as { value: number }).value).toBe(24)

    const call = vi.mocked(db.query).mock.calls[0]
    expect(call[1]).toContain('COUNT(*)')
  })

  test('returns bucketed productivity category hours', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [
        { bucket_start: new Date('2026-01-01T00:00:00Z'), value: 3.5 },
        { bucket_start: new Date('2026-01-02T00:00:00Z'), value: 4.2 },
      ],
    } as never)

    const result = await getChartData('testuser', {
      aggregation: 'count',
      bucket_size: '1d',
      end: '2026-01-31T23:59:59Z',
      pattern: 'Work > Programming',
      source_type: 'productivity_category',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result.buckets).toHaveLength(2)
    expect((result.buckets[0] as { value: number }).value).toBe(3.5)
    expect((result.buckets[1] as { value: number }).value).toBe(4.2)

    // Verify we query from activities (not productivity) after the migration
    // to screentime activities as the source of truth.
    const call = vi.mocked(db.query).mock.calls[0]
    expect(call[1]).toContain('FROM activities')
    expect(call[1]).toContain("data->>'category_path' = $3")
    expect(call[1]).toContain("starts_with(data->>'category_path', $3 || ' > ')")
    expect(call[1]).not.toMatch(/activity_type\s*(=|IN)/)
    expect(call[1]).not.toContain('FROM productivity')
  })

  test('returns bucketed activity type hours', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ bucket_start: new Date('2026-01-06T00:00:00Z'), value: 2.75 }],
    } as never)

    const result = await getChartData('testuser', {
      aggregation: 'count',
      bucket_size: '1w',
      end: '2026-01-31T23:59:59Z',
      pattern: 'running',
      source_type: 'activity_type',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result.buckets).toHaveLength(1)
    expect((result.buckets[0] as { value: number }).value).toBe(2.75)
  })

  test('uses date_trunc with hour for 1h bucket size', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [
        { bucket_start: new Date('2026-01-01T10:00:00Z'), value: 2n },
        { bucket_start: new Date('2026-01-01T11:00:00Z'), value: 3n },
      ],
    } as never)

    const result = await getChartData('testuser', {
      aggregation: 'count',
      bucket_size: '1h',
      end: '2026-01-01T23:59:59Z',
      pattern: 'coffee',
      source_type: 'tag',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result.buckets).toHaveLength(2)
    expect(result.buckets[0].bucket_start).toBe('2026-01-01T10:00:00.000Z')
    expect((result.buckets[0] as { value: number }).value).toBe(2)

    const call = vi.mocked(db.query).mock.calls[0]
    expect(call[1]).toContain('date_trunc')
    expect(call[2]![0]).toBe('hour')
  })

  test('uses date_bin with 15 minutes interval for 15m bucket size', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [
        { bucket_start: new Date('2026-01-01T10:00:00Z'), value: 1n },
        { bucket_start: new Date('2026-01-01T10:15:00Z'), value: 2n },
      ],
    } as never)

    const result = await getChartData('testuser', {
      aggregation: 'count',
      bucket_size: '15m',
      end: '2026-01-01T23:59:59Z',
      pattern: 'coffee',
      source_type: 'tag',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result.buckets).toHaveLength(2)
    expect(result.buckets[0].bucket_start).toBe('2026-01-01T10:00:00.000Z')
    expect((result.buckets[1] as { value: number }).value).toBe(2)

    const call = vi.mocked(db.query).mock.calls[0]
    expect(call[1]).toContain('date_bin')
    expect(call[2]![0]).toBe('15 minutes')
  })

  test('returns empty buckets for metric without pattern', async () => {
    const result = await getChartData('testuser', {
      aggregation: 'mean',
      bucket_size: '1d',
      end: '2026-01-31T23:59:59Z',
      source_type: 'metric',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result.buckets).toEqual([])
    expect(db.query).not.toHaveBeenCalled()
  })

  test('activity_type with count aggregation uses count(*)', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ bucket_start: new Date('2026-01-01T00:00:00Z'), value: 5n }],
    } as never)

    const result = await getChartData('testuser', {
      aggregation: 'count',
      bucket_size: '1d',
      end: '2026-01-31T23:59:59Z',
      pattern: 'sex',
      source_type: 'activity_type',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result.buckets).toHaveLength(1)
    expect((result.buckets[0] as { value: number }).value).toBe(5)
    const sql = vi.mocked(db.query).mock.calls[0][1] as string
    expect(sql).toContain('count(*)')
  })

  test('activity_type with breakdown_fields returns breakdown buckets', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [
        { bucket_start: new Date('2026-01-01T00:00:00Z'), field_0: 'Sara', value: 2 },
        { bucket_start: new Date('2026-01-01T00:00:00Z'), field_0: 'Other', value: 1 },
        { bucket_start: new Date('2026-01-08T00:00:00Z'), field_0: 'Sara', value: 3 },
      ],
    } as never)

    const result = await getChartData('testuser', {
      aggregation: 'count',
      breakdown_fields: ['partner'],
      bucket_size: '1w',
      end: '2026-01-31T23:59:59Z',
      pattern: 'sex',
      source_type: 'activity_type',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result.breakdown_fields).toEqual(['partner'])
    expect(result.breakdown_series).toEqual(['Other', 'Sara'])
    expect(result.buckets).toHaveLength(2)

    const first = result.buckets[0] as { series: Record<string, number> }
    expect(first.series).toEqual({ Other: 1, Sara: 2 })
  })

  test('multi-field breakdown produces compound series keys', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [
        {
          bucket_start: new Date('2026-01-01T00:00:00Z'),
          field_0: 'spanda',
          field_1: 'external',
          value: 3.5,
        },
        { bucket_start: new Date('2026-01-01T00:00:00Z'), field_0: 'spanda', field_1: 'laptop', value: 1.0 },
      ],
    } as never)

    const result = await getChartData('testuser', {
      aggregation: 'sum',
      breakdown_fields: ['device', 'display'],
      bucket_size: '1d',
      end: '2026-01-31T23:59:59Z',
      pattern: 'computer_active',
      source_type: 'activity_type',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result.breakdown_fields).toEqual(['device', 'display'])
    expect(result.breakdown_series).toEqual(['spanda / external', 'spanda / laptop'])

    const first = result.buckets[0] as { series: Record<string, number> }
    expect(first.series['spanda / external']).toBe(3.5)
    expect(first.series['spanda / laptop']).toBe(1.0)
  })

  test('breakdown_fields with invalid name returns empty', async () => {
    const result = await getChartData('testuser', {
      aggregation: 'count',
      breakdown_fields: ['DROP TABLE'],
      bucket_size: '1d',
      end: '2026-01-31T23:59:59Z',
      pattern: 'test',
      source_type: 'activity_type',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result.buckets).toEqual([])
    expect(db.query).not.toHaveBeenCalled()
  })

  test('max aggregation takes MAX(value) for metrics', async () => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ bucket_start: new Date('2026-01-01T00:00:00Z'), value: 82.5 }],
    } as never)

    await getChartData('testuser', {
      aggregation: 'max',
      bucket_size: '1w',
      end: '2026-01-31T23:59:59Z',
      pattern: 'weight',
      source_type: 'metric',
      start: '2026-01-01T00:00:00Z',
    })

    expect(vi.mocked(db.query).mock.calls[0][1]).toContain('MAX(value) AS value')
  })

  test('max aggregation takes the longest activity of each bucket', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as never)

    await getChartData('testuser', {
      aggregation: 'max',
      bucket_size: '1w',
      end: '2026-01-31T23:59:59Z',
      pattern: 'running',
      source_type: 'activity_type',
      start: '2026-01-01T00:00:00Z',
    })

    const sql = vi.mocked(db.query).mock.calls[0][1] as string
    expect(sql).toContain('MAX(EXTRACT(EPOCH')
    expect(sql).not.toContain('SUM(')
  })

  describe('measures of list items', () => {
    const strengthDef: ActivityTypeDefinition = {
      aliases: [],
      color: '#000000',
      data_schema: {
        fields: [
          { name: 'location', type: 'string' },
          { item_fields: [{ name: 'exercise', type: 'string' }], name: 'sets', type: 'list' },
        ],
      },
      display_category: 'exercise',
      display_name: 'Strength',
      is_builtin: true,
      name: 'strength_training',
      show_on_timeline: true,
    }

    const lift = (
      id: string,
      startIso: string,
      location: string,
      sets: Record<string, unknown>[],
    ): MergedActivity => ({
      activity_type: 'strength_training',
      data: { location, sets },
      end_time: new Date(new Date(startIso).getTime() + 3_600_000),
      id,
      source: 'gravl',
      start_time: new Date(startIso),
    })
    const set = (exercise: string, weight: number, reps: number) => ({ exercise, reps, weight })

    // Weeks of 2026-01-05 (w1) and 2026-01-12 (w2)
    const a1 = lift('a1', '2026-01-05T17:00:00Z', 'Gym', [set('Bench Press', 80, 5), set('Squat', 100, 5)])
    const a2 = lift('a2', '2026-01-07T17:00:00Z', 'Home', [set('bench press', 90, 1)])
    const a3 = lift('a3', '2026-01-12T17:00:00Z', 'Gym', [set('Squat', 110, 3)])
    const a4 = lift('a4', '2026-01-13T17:00:00Z', 'Gym', [{ exercise: 'Plank', time: 60 }])
    const w1 = new Date('2026-01-05T00:00:00Z')
    const w2 = new Date('2026-01-12T00:00:00Z')

    const base = {
      bucket_size: '1w' as const,
      end: '2026-01-31T23:59:59Z',
      pattern: 'strength_training',
      source_type: 'activity_type' as const,
      start: '2026-01-01T00:00:00Z',
    }

    beforeEach(() => {
      vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([strengthDef])
      vi.mocked(db.getActivities).mockResolvedValue([a1, a2, a3, a4])
      vi.mocked(db.getBucketStarts).mockResolvedValue(
        new Map([
          ['a1', w1],
          ['a2', w1],
          ['a3', w2],
          ['a4', w2],
        ]),
      )
    })

    test('sums each session’s measure per bucket, bucketed in SQL', async () => {
      const result = await getChartData('u', {
        ...base,
        aggregation: 'sum',
        measure: 'volume',
        tz: 'Europe/Stockholm',
      })

      expect(result).toEqual({
        buckets: [
          { bucket_start: w1.toISOString(), value: 990 },
          { bucket_start: w2.toISOString(), value: 330 },
        ],
      })
      expect(db.getBucketStarts).toHaveBeenCalledWith('u', ['a1', 'a2', 'a3', 'a4'], '1w', 'Europe/Stockholm')
      expect(db.query).not.toHaveBeenCalled()
    })

    test('max takes the best session; count the sessions having the measure', async () => {
      const max = await getChartData('u', { ...base, aggregation: 'max', measure: 'e1rm' })
      const count = await getChartData('u', { ...base, aggregation: 'count', measure: 'e1rm' })

      expect(max.buckets).toEqual([
        { bucket_start: w1.toISOString(), value: 116.7 },
        { bucket_start: w2.toISOString(), value: 121 },
      ])
      expect(count.buckets).toEqual([
        { bucket_start: w1.toISOString(), value: 2 },
        { bucket_start: w2.toISOString(), value: 1 },
      ])
    })

    test('an exercise filter measures only its items and leaves out buckets without it', async () => {
      const result = await getChartData('u', {
        ...base,
        aggregation: 'max',
        filter_field: 'sets.exercise',
        filter_value: 'Bench Press',
        measure: 'e1rm',
      })

      expect(result.buckets).toEqual([{ bucket_start: w1.toISOString(), value: 93.3 }])
    })

    test('an item-path breakdown gives one series per exercise, spelled as in the latest session', async () => {
      const result = await getChartData('u', {
        ...base,
        aggregation: 'max',
        breakdown_fields: ['sets.exercise'],
        measure: 'e1rm',
      })

      expect(result.breakdown_fields).toEqual(['sets.exercise'])
      expect(result.breakdown_series).toEqual(['Squat', 'bench press'])
      expect(result.buckets).toEqual([
        { bucket_start: w1.toISOString(), series: { Squat: 116.7, 'bench press': 93.3 } },
        { bucket_start: w2.toISOString(), series: { Squat: 121 } },
      ])
    })

    test('a scalar and an item field compound, the measure taken over the item', async () => {
      const result = await getChartData('u', {
        ...base,
        aggregation: 'sum',
        breakdown_fields: ['location', 'sets.exercise'],
        measure: 'set_count',
      })

      expect(result.breakdown_series).toEqual([
        'Gym / Bench Press',
        'Gym / Plank',
        'Gym / Squat',
        'Home / bench press',
      ])
      expect(result.buckets).toEqual([
        {
          bucket_start: w1.toISOString(),
          series: { 'Gym / Bench Press': 1, 'Gym / Squat': 1, 'Home / bench press': 1 },
        },
        { bucket_start: w2.toISOString(), series: { 'Gym / Plank': 1, 'Gym / Squat': 1 } },
      ])
    })

    test('a scalar breakdown uses the session’s measure', async () => {
      const result = await getChartData('u', {
        ...base,
        aggregation: 'max',
        breakdown_fields: ['location'],
        measure: 'max_weight',
      })

      expect(result.breakdown_series).toEqual(['Gym', 'Home'])
      expect(result.buckets).toEqual([
        { bucket_start: w1.toISOString(), series: { Gym: 100, Home: 90 } },
        { bucket_start: w2.toISOString(), series: { Gym: 110 } },
      ])
    })
  })

  // Regression: activity-based chart queries must skip rows that the merge
  // pipeline marked as cross-source duplicates (`superseded_by IS NOT NULL`),
  // otherwise a 21-minute run synced by Garmin + Oura + Health Connect ends
  // up charted as ~60 minutes.
  describe('superseded_by filtering', () => {
    const emptyResult = { rows: [] } as never

    test('tag source with activity_type_id filters superseded rows', async () => {
      vi.mocked(db.query).mockResolvedValue(emptyResult)
      await getChartData('testuser', {
        aggregation: 'count',
        bucket_size: '1d',
        end: '2026-01-31T23:59:59Z',
        source_type: 'tag',
        start: '2026-01-01T00:00:00Z',
        tag_definition_id: '550e8400-e29b-41d4-a716-446655440000',
      })
      const sql = vi.mocked(db.query).mock.calls[0][1] as string
      expect(sql).toContain('superseded_by IS NULL')
    })

    test('tag source with pattern filters superseded rows', async () => {
      vi.mocked(db.query).mockResolvedValue(emptyResult)
      await getChartData('testuser', {
        aggregation: 'count',
        bucket_size: '1w',
        end: '2026-01-31T23:59:59Z',
        pattern: 'coffee',
        source_type: 'tag',
        start: '2026-01-01T00:00:00Z',
      })
      const sql = vi.mocked(db.query).mock.calls[0][1] as string
      expect(sql).toContain('superseded_by IS NULL')
    })

    test('activity_type source (sum hours) filters superseded rows', async () => {
      vi.mocked(db.query).mockResolvedValue(emptyResult)
      await getChartData('testuser', {
        aggregation: 'sum',
        bucket_size: '1d',
        end: '2026-01-31T23:59:59Z',
        pattern: 'running',
        source_type: 'activity_type',
        start: '2026-01-01T00:00:00Z',
      })
      const sql = vi.mocked(db.query).mock.calls[0][1] as string
      expect(sql).toContain('superseded_by IS NULL')
    })

    test('activity_type breakdown queries filter superseded rows', async () => {
      vi.mocked(db.query).mockResolvedValue(emptyResult)
      await getChartData('testuser', {
        aggregation: 'sum',
        breakdown_fields: ['partner'],
        bucket_size: '1w',
        end: '2026-01-31T23:59:59Z',
        pattern: 'running',
        source_type: 'activity_type',
        start: '2026-01-01T00:00:00Z',
      })
      const sql = vi.mocked(db.query).mock.calls[0][1] as string
      expect(sql).toContain('superseded_by IS NULL')
    })
  })
})

describe('buildBucketExpr', () => {
  test.each([
    ['1d', 'day'],
    ['1w', 'week'],
    ['1M', 'month'],
    ['1h', 'hour'],
  ])('%s truncates to %s in the given zone, bound as a parameter', (size, unit) => {
    const { expr, params } = buildBucketExpr(size, 'time', 1, 'Europe/Stockholm')
    expect(expr).toBe('date_trunc($1::text, time, $2::text)')
    expect(params).toEqual([unit, 'Europe/Stockholm'])
  })

  test('defaults the zone to UTC', () => {
    expect(buildBucketExpr('1d', 'time', 1).params).toEqual(['day', 'UTC'])
  })

  test.each([
    ['1m', '1 minute'],
    ['5m', '5 minutes'],
    ['15m', '15 minutes'],
  ])('%s bins on a UTC origin and takes no zone', (size, interval) => {
    const { expr, params } = buildBucketExpr(size, 'start_time', 1, 'Asia/Kathmandu')
    expect(expr).toBe("date_bin($1::interval, start_time, '2000-01-01T00:00:00Z'::timestamptz)")
    expect(params).toEqual([interval])
  })

  test('never interpolates the zone into the SQL', () => {
    const evil = "UTC'); DROP TABLE activities; --"
    for (const size of ['1m', '5m', '15m', '1h', '1d', '1w', '1M']) {
      expect(buildBucketExpr(size, 'time', 1, evil).expr).not.toContain('DROP')
    }
  })

  test('uses correct placeholder index', () => {
    const { expr } = buildBucketExpr('1d', 'time', 3)
    expect(expr).toBe('date_trunc($3::text, time, $4::text)')
  })
})
