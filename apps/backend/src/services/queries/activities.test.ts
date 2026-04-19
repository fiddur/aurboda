import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { queryActivities } from './activities.ts'

// Mock the db module
vi.mock('../../db', () => ({
  expandActivityTypes: vi.fn().mockImplementation((_user: string, types: string[]) => Promise.resolve(types)),
  getActivities: vi.fn(),
  getActivityTypeDefinitions: vi.fn().mockResolvedValue([]),
  getNotesByEntityIds: vi.fn(),
  getTimeSeries: vi.fn(),
  getUserSettings: vi.fn(),
}))

describe('queryActivities with comments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getUserSettings).mockResolvedValue(null)
  })

  test('attaches comments to activities', async () => {
    const activityId = 'activity-id-1'
    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:30:00Z'),
        id: activityId,
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
    ])

    const notesMap = new Map([
      [
        activityId,
        [
          {
            content: 'Felt great!',
            created_at: new Date('2024-01-15T11:00:00Z'),
            entity_id: activityId,
            entity_type: 'activity' as const,
            id: 'note-1',
            updated_at: new Date('2024-01-15T11:00:00Z'),
          },
        ],
      ],
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(notesMap)
    vi.mocked(db.getTimeSeries).mockResolvedValue([])

    const result = await queryActivities(
      'testuser',
      ['exercise'],
      new Date('2024-01-15'),
      new Date('2024-01-16'),
    )

    expect(result).toHaveLength(1)
    expect(result[0].comments).toHaveLength(1)
    expect(result[0].comments[0].content).toBe('Felt great!')
  })

  test('returns empty comments array when no notes exist', async () => {
    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activity_type: 'exercise',
        id: 'activity-1',
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(new Map())

    const result = await queryActivities(
      'testuser',
      ['exercise'],
      new Date('2024-01-15'),
      new Date('2024-01-16'),
    )

    expect(result[0].comments).toEqual([])
  })
})
