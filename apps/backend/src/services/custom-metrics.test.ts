import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import { mergeCustomMetricService } from './custom-metrics.ts'

vi.mock('../db', () => ({
  getCustomMetricByName: vi.fn(),
  mergeCustomMetric: vi.fn(),
  // Stubs for other imports used by the module
  deleteCustomMetricDefinition: vi.fn(),
  deleteTimeSeriesMetric: vi.fn(),
  deleteTimeSeriesPoint: vi.fn(),
  getCustomMetricDefinitions: vi.fn(),
  insertCustomMetricDefinition: vi.fn(),
  updateCustomMetricDefinition: vi.fn(),
}))

const user = 'testuser'

describe('mergeCustomMetricService', () => {
  beforeEach(() => vi.clearAllMocks())

  test('returns error when source equals target', async () => {
    const result = await mergeCustomMetricService(user, 'stress', 'stress')
    expect(result.success).toBe(false)
    expect(result.error).toContain('same metric')
  })

  test('returns error when source is not a custom metric', async () => {
    vi.mocked(db.getCustomMetricByName).mockResolvedValue(null)

    const result = await mergeCustomMetricService(user, 'nonexistent', 'stress_level')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  test('returns error when target does not exist', async () => {
    vi.mocked(db.getCustomMetricByName)
      .mockResolvedValueOnce({ name: 'oura_daytime_stress', unit: 'score' }) // source
      .mockResolvedValueOnce(null) // target (not custom either)

    const result = await mergeCustomMetricService(user, 'oura_daytime_stress', 'nonexistent_metric')
    expect(result.success).toBe(false)
    expect(result.error).toContain('does not exist')
  })

  test('merges into a built-in metric with correct unit', async () => {
    vi.mocked(db.getCustomMetricByName).mockResolvedValueOnce({
      name: 'oura_daytime_stress',
      unit: 'score',
    })
    vi.mocked(db.mergeCustomMetric).mockResolvedValue({
      rows_reassigned: 150,
      rows_skipped: 3,
    })

    const result = await mergeCustomMetricService(user, 'oura_daytime_stress', 'stress_level')

    expect(result.success).toBe(true)
    expect(result.rows_reassigned).toBe(150)
    expect(result.rows_skipped).toBe(3)
    expect(db.mergeCustomMetric).toHaveBeenCalledWith(user, 'oura_daytime_stress', 'stress_level', 'score')
  })

  test('merges into another custom metric with its unit', async () => {
    vi.mocked(db.getCustomMetricByName)
      .mockResolvedValueOnce({ name: 'old_mood', unit: 'scale' }) // source
      .mockResolvedValueOnce({ name: 'mood', unit: 'score' }) // target
    vi.mocked(db.mergeCustomMetric).mockResolvedValue({
      rows_reassigned: 42,
      rows_skipped: 0,
    })

    const result = await mergeCustomMetricService(user, 'old_mood', 'mood')

    expect(result.success).toBe(true)
    expect(result.rows_reassigned).toBe(42)
    expect(db.mergeCustomMetric).toHaveBeenCalledWith(user, 'old_mood', 'mood', 'score')
  })
})
