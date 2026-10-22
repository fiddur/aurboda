import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import * as queries from '../queries/index.ts'
import { getBaseline } from './baseline.ts'

vi.mock('../../db', () => ({
  getTimeSeriesStats: vi.fn(),
}))

// Mock queries module (for queryMetrics used by getBaseline)
vi.mock('../queries/index', async (importOriginal) => {
  const actual = await importOriginal<typeof queries>()
  return {
    ...actual,
    queryMetrics: vi.fn(),
  }
})

describe('getBaseline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const emptyHrvResult = { count: 0, data: [], metric: 'hrv_sleep', unit: 'ms' }

  test('returns sleep HRV and resting HR baseline statistics', async () => {
    // One hrv_sleep fetch over all three windows (reference 2024-01-15):
    // 7-day from Jan 8, 30-day from Dec 16, previous 30-day Nov 16 – Dec 15.
    vi.mocked(queries.queryMetrics).mockResolvedValueOnce({
      count: 7,
      data: [
        { time: '2023-12-01T02:00:00Z', value: 41 },
        { time: '2023-12-10T02:00:00Z', value: 45 },
        { time: '2024-01-01T02:00:00Z', value: 42 },
        { time: '2024-01-05T02:00:00Z', value: 46.4 },
        { time: '2024-01-13T02:00:00Z', value: 40 },
        { time: '2024-01-14T02:00:00Z', value: 46 },
        { time: '2024-01-15T02:00:00Z', value: 50.5 },
      ],
      metric: 'hrv_sleep',
      unit: 'ms',
    })

    // Mock resting HR stats (3 calls: 7-day, 30-day, prev-30) and stress stats (3 calls)
    vi.mocked(db.getTimeSeriesStats)
      .mockResolvedValueOnce([
        { avg: 60.3, count: 100, max: 70, metric: 'resting_heart_rate', min: 52, stddev: 3, unit: 'bpm' },
      ]) // 7-day resting HR
      .mockResolvedValueOnce([
        { avg: 61.1, count: 400, max: 72, metric: 'resting_heart_rate', min: 50, stddev: 4, unit: 'bpm' },
      ]) // 30-day resting HR
      .mockResolvedValueOnce([
        { avg: 62.5, count: 400, max: 73, metric: 'resting_heart_rate', min: 51, stddev: 4, unit: 'bpm' },
      ]) // previous 30-day HR
      .mockResolvedValueOnce([
        { avg: 35.2, count: 100, max: 80, metric: 'stress_level', min: 10, stddev: 12, unit: '' },
      ]) // 7-day stress
      .mockResolvedValueOnce([
        { avg: 37.5, count: 400, max: 85, metric: 'stress_level', min: 8, stddev: 14, unit: '' },
      ]) // 30-day stress
      .mockResolvedValueOnce([
        { avg: 40.0, count: 400, max: 90, metric: 'stress_level', min: 12, stddev: 15, unit: '' },
      ]) // previous 30-day stress

    const result = await getBaseline('testuser', new Date('2024-01-15T12:00:00Z'))

    expect(queries.queryMetrics).toHaveBeenCalledTimes(1)
    const [, metric, start] = vi.mocked(queries.queryMetrics).mock.calls[0]
    expect(metric).toBe('hrv_sleep')
    expect(start.getTime()).toBeLessThan(new Date('2023-11-17T00:00:00Z').getTime())
    expect(db.getTimeSeriesStats).not.toHaveBeenCalledWith(
      'testuser',
      ['hrv_rmssd'],
      expect.anything(),
      expect.anything(),
    )

    expect(result.hrv.avg7day).toBe(45.5) // (40 + 46 + 50.5) / 3
    expect(result.hrv.avg30day).toBe(45) // (42 + 46.4 + 40 + 46 + 50.5) / 5 = 44.98
    expect(result.hrv.trend_percent).toBe(4.6) // vs previous (41 + 45) / 2 = 43
    expect(result.resting_hr.avg7day).toBe(60.3)
    expect(result.resting_hr.avg30day).toBe(61.1)
    expect(result.stress.avg7day).toBe(35.2)
    expect(result.stress.avg30day).toBe(37.5)

    // Verify trends are calculated (30-day vs previous 30-day)
    expect(result.hrv.trend_percent).not.toBeNull()
    expect(result.resting_hr.trend_percent).not.toBeNull()
    expect(result.stress.trend_percent).not.toBeNull()
    expect(result.period.start).toBeDefined()
    expect(result.period.end).toBeDefined()
  })

  test('handles missing data gracefully', async () => {
    vi.mocked(queries.queryMetrics).mockResolvedValue(emptyHrvResult)
    vi.mocked(db.getTimeSeriesStats).mockResolvedValue([])

    const result = await getBaseline('testuser')

    expect(queries.queryMetrics).toHaveBeenCalledTimes(1)

    expect(result.hrv.avg7day).toBeNull()
    expect(result.hrv.avg30day).toBeNull()
    expect(result.resting_hr.avg7day).toBeNull()
    expect(result.resting_hr.avg30day).toBeNull()
    expect(result.stress.avg7day).toBeNull()
    expect(result.stress.avg30day).toBeNull()
  })

  test('falls back to raw hrv_rmssd when no samples overlap sleep windows (#747)', async () => {
    vi.mocked(queries.queryMetrics).mockResolvedValue(emptyHrvResult)

    vi.mocked(db.getTimeSeriesStats).mockImplementation(async (_user, metrics) => {
      if (metrics.includes('hrv_rmssd')) {
        return [{ avg: 43, count: 8, max: 50, metric: 'hrv_rmssd', min: 38, stddev: 3, unit: 'ms' }]
      }
      if (metrics.includes('resting_heart_rate')) {
        return [
          { avg: 55.9, count: 8, max: 60, metric: 'resting_heart_rate', min: 52, stddev: 2, unit: 'bpm' },
        ]
      }
      return [{ avg: 30, count: 8, max: 60, metric: 'stress_level', min: 5, stddev: 10, unit: '' }]
    })

    const result = await getBaseline('testuser')

    expect(result.hrv.avg7day).toBe(43)
    expect(result.hrv.avg30day).toBe(43)
    expect(result.resting_hr.avg7day).toBe(55.9)
    const hrvRmssdCalls = vi
      .mocked(db.getTimeSeriesStats)
      .mock.calls.filter((call) => call[1].includes('hrv_rmssd'))
    expect(hrvRmssdCalls).toHaveLength(3) // 7-day, 30-day, prev-30
  })

  test('falls back to raw hrv_rmssd only for the windows with no sleep samples', async () => {
    vi.mocked(queries.queryMetrics).mockResolvedValue({
      count: 2,
      data: [
        { time: '2023-12-01T02:00:00Z', value: 41 },
        { time: '2023-12-10T02:00:00Z', value: 45 },
      ],
      metric: 'hrv_sleep',
      unit: 'ms',
    })
    vi.mocked(db.getTimeSeriesStats).mockImplementation(async (_user, metrics) =>
      metrics.includes('hrv_rmssd')
        ? [{ avg: 47.3, count: 8, max: 50, metric: 'hrv_rmssd', min: 38, stddev: 3, unit: 'ms' }]
        : [],
    )

    const result = await getBaseline('testuser', new Date('2024-01-15T12:00:00Z'))

    expect(result.hrv.avg7day).toBe(47.3)
    expect(result.hrv.avg30day).toBe(47.3)
    expect(result.hrv.trend_percent).toBe(10) // 47.3 vs previous-window sleep avg 43
    const hrvRmssdCalls = vi
      .mocked(db.getTimeSeriesStats)
      .mock.calls.filter((call) => call[1].includes('hrv_rmssd'))
    expect(hrvRmssdCalls).toHaveLength(2) // 7-day and 30-day; previous window had sleep samples
  })

  test('prefers contextual hrv_sleep over raw hrv_rmssd when both exist', async () => {
    vi.mocked(queries.queryMetrics).mockResolvedValue({
      count: 3,
      data: [
        { time: '2023-12-05T02:00:00Z', value: 55 },
        { time: '2024-01-14T02:00:00Z', value: 50 },
        { time: '2024-01-15T02:00:00Z', value: 60 },
      ],
      metric: 'hrv_sleep',
      unit: 'ms',
    })
    vi.mocked(db.getTimeSeriesStats).mockResolvedValue([
      { avg: 100, count: 8, max: 110, metric: 'resting_heart_rate', min: 90, stddev: 5, unit: 'bpm' },
    ])

    const result = await getBaseline('testuser', new Date('2024-01-15T12:00:00Z'))

    expect(result.hrv.avg7day).toBe(55) // hrv_sleep avg, NOT 100 from any fallback
    // hrv_rmssd should NOT be queried when sleep HRV exists
    const hrvRmssdCalls = vi
      .mocked(db.getTimeSeriesStats)
      .mock.calls.filter((call) => call[1].includes('hrv_rmssd'))
    expect(hrvRmssdCalls).toHaveLength(0)
  })

  test('uses reference date when provided', async () => {
    vi.mocked(queries.queryMetrics).mockResolvedValue(emptyHrvResult)
    vi.mocked(db.getTimeSeriesStats).mockResolvedValue([])

    const referenceDate = new Date('2024-01-15T12:00:00Z')
    await getBaseline('testuser', referenceDate)

    // queryMetrics called for sleep HRV with dates from reference date
    expect(queries.queryMetrics).toHaveBeenCalled()
    const hrvCalls = vi.mocked(queries.queryMetrics).mock.calls
    const [, metric, , endDate] = hrvCalls[0]
    expect(metric).toBe('hrv_sleep')
    expect(endDate.toISOString().split('T')[0]).toBe('2024-01-15')

    // getTimeSeriesStats called for resting HR, stress, and the hrv_rmssd fallback
    // (3 each since hrv_sleep was empty in this test) with dates from reference date
    expect(db.getTimeSeriesStats).toHaveBeenCalledTimes(9)
    const statsCalls = vi.mocked(db.getTimeSeriesStats).mock.calls
    const [, , , hrEndDate] = statsCalls[0]
    expect(new Date(hrEndDate).toISOString().split('T')[0]).toBe('2024-01-15')
  })
})
