import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { Activity } from '../db/types.ts'

import * as db from '../db/index.ts'
import { deleteProductivity, restoreActivity, restoreProductivity } from './restore.ts'
import { reanalyseOverrideTargets } from './track-analyse.ts'

vi.mock('./track-analyse.ts', () => ({
  reanalyseOverrideTargets: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../db', () => ({
  deleteProductivityRecord: vi.fn(),
  getActivityById: vi.fn().mockResolvedValue(null),
  materializeSuperseded: vi.fn().mockResolvedValue(undefined),
  restoreActivity: vi.fn(),
  restoreProductivityRecord: vi.fn(),
}))

describe('restoreActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns success when activity is restored', async () => {
    vi.mocked(db.restoreActivity).mockResolvedValue(true)
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })

    const result = await restoreActivity('testuser', 'activity-123')

    expect(result).toEqual({
      id: 'activity-123',
      restored: true,
      success: true,
    })
    expect(db.restoreActivity).toHaveBeenCalledWith('testuser', 'activity-123')
    expect(db.materializeSuperseded).toHaveBeenCalledWith('testuser', new Date('2024-03-15T10:00:00Z'))
  })

  test('a restored override re-analyses its targets', async () => {
    const override: Activity = {
      activity_type: 'running',
      id: 'override-1',
      override_target_ids: ['garmin-1'],
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    }
    vi.mocked(db.restoreActivity).mockResolvedValue(true)
    vi.mocked(db.getActivityById).mockResolvedValue(override)

    await restoreActivity('testuser', 'override-1')

    expect(reanalyseOverrideTargets).toHaveBeenCalledExactlyOnceWith('testuser', override)
  })

  test('returns failure when activity not found', async () => {
    vi.mocked(db.restoreActivity).mockResolvedValue(false)

    const result = await restoreActivity('testuser', 'nonexistent')

    expect(result).toEqual({
      id: 'nonexistent',
      restored: false,
      success: false,
    })
    expect(reanalyseOverrideTargets).not.toHaveBeenCalled()
  })
})

describe('restoreProductivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns success when record is restored', async () => {
    vi.mocked(db.restoreProductivityRecord).mockResolvedValue(true)

    const result = await restoreProductivity('testuser', 'prod-456')

    expect(result).toEqual({ id: 'prod-456', restored: true, success: true })
    expect(db.restoreProductivityRecord).toHaveBeenCalledWith('testuser', 'prod-456')
  })

  test('returns failure when record not found', async () => {
    vi.mocked(db.restoreProductivityRecord).mockResolvedValue(false)

    const result = await restoreProductivity('testuser', 'nonexistent')

    expect(result).toEqual({
      id: 'nonexistent',
      restored: false,
      success: false,
    })
    expect(reanalyseOverrideTargets).not.toHaveBeenCalled()
  })
})

describe('deleteProductivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns success when record is deleted', async () => {
    vi.mocked(db.deleteProductivityRecord).mockResolvedValue(true)

    const result = await deleteProductivity('testuser', 'prod-789')

    expect(result).toEqual({ deleted: true, id: 'prod-789', success: true })
    expect(db.deleteProductivityRecord).toHaveBeenCalledWith('testuser', 'prod-789')
  })

  test('returns failure when record not found', async () => {
    vi.mocked(db.deleteProductivityRecord).mockResolvedValue(false)

    const result = await deleteProductivity('testuser', 'nonexistent')

    expect(result).toEqual({
      deleted: false,
      id: 'nonexistent',
      success: false,
    })
  })
})
