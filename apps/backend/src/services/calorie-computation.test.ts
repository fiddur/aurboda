import { beforeEach, describe, expect, test, vi } from 'vitest'

import { enqueueCalorieSync } from './calorie-computation.ts'

const mockEnqueueInserts = vi.fn().mockResolvedValue(0)
vi.mock('../db/index.ts', () => ({
  enqueueOutboundSyncInsertsIfChanged: (...args: unknown[]) => mockEnqueueInserts(...args),
  getUserSettings: vi.fn(),
  upsertUserSettings: vi.fn(),
}))

describe('enqueueCalorieSync', () => {
  beforeEach(() => {
    mockEnqueueInserts.mockClear()
  })

  test('does nothing for empty points array', async () => {
    await enqueueCalorieSync('test-user', [])
    expect(mockEnqueueInserts).not.toHaveBeenCalled()
  })

  test('offers every point, regardless of age, in one bulk call', async () => {
    const oldPoint = {
      end_time: new Date('2024-01-01T10:01:00Z'),
      kcal_active: 5.5,
      time: new Date('2024-01-01T10:00:00Z'),
    }
    const recentPoint = {
      end_time: new Date('2026-03-17T10:01:00Z'),
      kcal_active: 12.3,
      time: new Date('2026-03-17T10:00:00Z'),
    }

    await enqueueCalorieSync('test-user', [oldPoint, recentPoint])

    expect(mockEnqueueInserts).toHaveBeenCalledTimes(1)
    expect(mockEnqueueInserts).toHaveBeenCalledWith(
      'test-user',
      'time_series',
      'ActiveCaloriesBurnedRecord',
      [
        {
          entity_id: `calories_active|${oldPoint.time.toISOString()}`,
          payload: {
            end_time: oldPoint.end_time.toISOString(),
            metric: 'calories_active',
            time: oldPoint.time.toISOString(),
            unit: 'kcal',
            value: 5.5,
          },
        },
        expect.objectContaining({ entity_id: `calories_active|${recentPoint.time.toISOString()}` }),
      ],
    )
  })

  test('swallows errors without throwing', async () => {
    mockEnqueueInserts.mockRejectedValueOnce(new Error('db error'))

    await expect(
      enqueueCalorieSync('test-user', [{ end_time: new Date(), kcal_active: 1, time: new Date() }]),
    ).resolves.toBeUndefined()
  })
})
