import { describe, expect, test, vi } from 'vitest'

import { enqueueCalorieSync } from './calorie-computation.ts'

// Mock the DB layer — enqueueCalorieSync depends on enqueueOutboundSync
const mockEnqueueOutboundSync = vi.fn().mockResolvedValue('mock-id')
vi.mock('../db/index.ts', () => ({
  enqueueOutboundSync: (...args: unknown[]) => mockEnqueueOutboundSync(...args),
  getUserSettings: vi.fn(),
  upsertUserSettings: vi.fn(),
}))

describe('enqueueCalorieSync', () => {
  test('does nothing for empty points array', async () => {
    await enqueueCalorieSync('test-user', [])
    expect(mockEnqueueOutboundSync).not.toHaveBeenCalled()
  })

  test('enqueues all points regardless of age', async () => {
    const oldPoint = {
      end_time: new Date('2024-01-01T10:01:00Z'),
      kcal: 5.5,
      time: new Date('2024-01-01T10:00:00Z'),
    }
    const recentPoint = {
      end_time: new Date('2026-03-17T10:01:00Z'),
      kcal: 12.3,
      time: new Date('2026-03-17T10:00:00Z'),
    }

    mockEnqueueOutboundSync.mockClear()
    await enqueueCalorieSync('test-user', [oldPoint, recentPoint])

    // Both points should be enqueued — no timestamp cutoff
    expect(mockEnqueueOutboundSync).toHaveBeenCalledTimes(2)
    expect(mockEnqueueOutboundSync).toHaveBeenCalledWith(
      'test-user',
      expect.objectContaining({
        entity_id: `calories_active|${oldPoint.time.toISOString()}`,
        hc_record_type: 'ActiveCaloriesBurnedRecord',
        operation: 'insert',
      }),
    )
    expect(mockEnqueueOutboundSync).toHaveBeenCalledWith(
      'test-user',
      expect.objectContaining({
        entity_id: `calories_active|${recentPoint.time.toISOString()}`,
      }),
    )
  })

  test('swallows errors without throwing', async () => {
    mockEnqueueOutboundSync.mockClear()
    mockEnqueueOutboundSync.mockRejectedValueOnce(new Error('db error'))

    // Should not throw
    await expect(
      enqueueCalorieSync('test-user', [{ end_time: new Date(), kcal: 1, time: new Date() }]),
    ).resolves.toBeUndefined()
  })
})
