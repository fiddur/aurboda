import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { queryTags } from './tags.ts'

// Mock the db module
vi.mock('../../db', () => ({
  getActivitiesExcludingCategories: vi.fn(),
  getNotesByEntityIds: vi.fn(),
}))

describe('queryTags with comments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('attaches comments when notes exist', async () => {
    const activityId = 'activity-id-1'
    vi.mocked(db.getActivitiesExcludingCategories).mockResolvedValue([
      {
        activity_type: 'coffee',
        external_id: 'ext-1',
        id: activityId,
        source: 'aurboda',
        start_time: new Date('2024-01-15T08:00:00Z'),
      },
    ])

    const notesMap = new Map([
      [
        activityId,
        [
          {
            content: 'Morning coffee',
            created_at: new Date('2024-01-15T08:01:00Z'),
            entity_id: activityId,
            entity_type: 'activity' as const,
            id: 'note-1',
            updated_at: new Date('2024-01-15T08:01:00Z'),
          },
        ],
      ],
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(notesMap)

    const result = await queryTags('testuser', new Date('2024-01-15'), new Date('2024-01-16'))

    expect(result).toHaveLength(1)
    expect(result[0].comments).toHaveLength(1)
    expect(result[0].comments[0].content).toBe('Morning coffee')
    expect(result[0].comments[0].id).toBe('note-1')
  })

  test('returns empty comments array when no notes exist', async () => {
    vi.mocked(db.getActivitiesExcludingCategories).mockResolvedValue([
      {
        activity_type: 'coffee',
        external_id: 'ext-1',
        id: 'activity-1',
        source: 'aurboda',
        start_time: new Date('2024-01-15T08:00:00Z'),
      },
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(new Map())

    const result = await queryTags('testuser', new Date('2024-01-15'), new Date('2024-01-16'))

    expect(result[0].comments).toEqual([])
  })
})
