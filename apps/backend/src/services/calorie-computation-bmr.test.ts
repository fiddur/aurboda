import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as dbIndex from '../db/index.ts'
import * as timeSeries from '../db/time-series.ts'
import { computeAndStoreCalories } from './calorie-computation.ts'

vi.mock('../db/index.ts', () => ({
  enqueueOutboundSync: vi.fn(),
  getUserSettings: vi.fn(),
  upsertUserSettings: vi.fn(),
}))

vi.mock('../db/time-series.ts', () => ({
  deleteTimeSeriesBySource: vi.fn(),
  getMetricTimeRange: vi.fn(),
  getTimeSeries: vi.fn(),
  insertTimeSeries: vi.fn(),
}))

describe('computeAndStoreCalories — Mifflin-St Jeor BMR from height metric', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Demo profile: male, 1985 DOB, UTC tz; no lab BMR so it falls back to Mifflin.
    vi.mocked(dbIndex.getUserSettings).mockResolvedValue({
      birth_date: '1985-01-01',
      device_timezone: 'UTC',
      sex: 'male',
    } as unknown as Awaited<ReturnType<typeof dbIndex.getUserSettings>>)
    vi.mocked(dbIndex.upsertUserSettings).mockResolvedValue(
      {} as unknown as Awaited<ReturnType<typeof dbIndex.upsertUserSettings>>,
    )
    vi.mocked(dbIndex.enqueueOutboundSync).mockResolvedValue('id')

    // The `height` metric is stored in METRES (canonical unit 'm').
    vi.mocked(timeSeries.getTimeSeries).mockImplementation((_user, metric) => {
      const now = new Date('2026-05-19T12:00:00Z')
      if (metric === 'weight') return Promise.resolve([[now, 78.9]])
      if (metric === 'height') return Promise.resolve([[now, 1.8]])
      // No lab BMR, no resting HR, no heart-rate samples.
      return Promise.resolve([])
    })
    vi.mocked(timeSeries.deleteTimeSeriesBySource).mockResolvedValue(0)
    vi.mocked(timeSeries.insertTimeSeries).mockResolvedValue(undefined)
  })

  test('BMR floor lands in a realistic 1500-2000 kcal/day band (height in cm, not m)', async () => {
    const result = await computeAndStoreCalories(
      'user',
      new Date('2026-05-19T00:00:00Z'),
      new Date('2026-05-19T01:00:00Z'),
      { skipSync: true },
    )

    expect(result.bmr_source).toBe('mifflin_st_jeor')

    // With no HR data, every stored calories_total minute is the pure BMR/min floor.
    const stored = vi.mocked(timeSeries.insertTimeSeries).mock.calls[0][1]
    const totalPoint = stored.find((p) => p.metric === 'calories_total')
    expect(totalPoint).toBeDefined()

    const bmrPerDay = totalPoint!.value * 1440
    // Expected ≈ 10·78.9 + 6.25·180 − 5·41 + 5 ≈ 1714 kcal/day.
    expect(bmrPerDay).toBeGreaterThan(1500)
    expect(bmrPerDay).toBeLessThan(2000)
    // Regression guard: the m-as-cm bug produced ≈ 600 kcal/day.
    expect(bmrPerDay).toBeGreaterThan(1000)
  })
})
