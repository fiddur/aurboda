import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import { getChartData } from './chart-data.ts'

// Mock the db module
vi.mock('../db', () => ({
  query: vi.fn(),
}))

describe('getChartData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns bucketed tag counts by tag_definition_id', async () => {
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

    expect(result).toHaveLength(2)
    expect(result[0].bucket_start).toBe('2026-01-01T00:00:00.000Z')
    expect(result[0].value).toBe(3)
    expect(result[1].value).toBe(5)

    // Verify the SQL uses date_trunc with 'day'
    const call = vi.mocked(db.query).mock.calls[0]
    expect(call[2]![0]).toBe('day')
  })

  test('returns bucketed tag counts by pattern', async () => {
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

    expect(result).toHaveLength(1)
    expect(result[0].value).toBe(7)

    // Verify the SQL uses date_trunc with 'week'
    const call = vi.mocked(db.query).mock.calls[0]
    expect(call[2]![0]).toBe('week')
  })

  test('returns empty array for tags without pattern or tag_definition_id', async () => {
    const result = await getChartData('testuser', {
      aggregation: 'count',
      bucket_size: '1d',
      end: '2026-01-31T23:59:59Z',
      source_type: 'tag',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result).toEqual([])
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

    expect(result).toHaveLength(2)
    expect(result[0].value).toBe(72.5)

    // Verify the SQL uses date_trunc with 'month'
    const call = vi.mocked(db.query).mock.calls[0]
    expect(call[2]![0]).toBe('month')
    // Verify AVG aggregation is used for 'mean'
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

    expect(result).toHaveLength(1)
    expect(result[0].value).toBe(8500)

    const call = vi.mocked(db.query).mock.calls[0]
    expect(call[1]).toContain('SUM(value)')
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

    expect(result).toHaveLength(1)
    expect(result[0].value).toBe(24)

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

    expect(result).toHaveLength(2)
    expect(result[0].value).toBe(3.5)
    expect(result[1].value).toBe(4.2)
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

    expect(result).toHaveLength(1)
    expect(result[0].value).toBe(2.75)
  })

  test('returns empty array for metric without pattern', async () => {
    const result = await getChartData('testuser', {
      aggregation: 'mean',
      bucket_size: '1d',
      end: '2026-01-31T23:59:59Z',
      source_type: 'metric',
      start: '2026-01-01T00:00:00Z',
    })

    expect(result).toEqual([])
    expect(db.query).not.toHaveBeenCalled()
  })
})
