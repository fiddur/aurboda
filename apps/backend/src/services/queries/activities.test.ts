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

  test('batches heart_rate and hrv_rmssd fetches across activities (no N+1)', async () => {
    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'ex-1',
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T15:00:00Z'),
        id: 'ex-2',
        source: 'health_connect',
        start_time: new Date('2024-01-15T14:00:00Z'),
      },
      {
        activity_type: 'sleep',
        end_time: new Date('2024-01-15T07:00:00Z'),
        id: 'sl-1',
        source: 'oura',
        start_time: new Date('2024-01-14T23:00:00Z'),
      },
      {
        activity_type: 'meditation',
        end_time: new Date('2024-01-15T09:30:00Z'),
        id: 'med-1',
        source: 'oura',
        start_time: new Date('2024-01-15T09:00:00Z'),
      },
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(new Map())
    vi.mocked(db.getTimeSeries).mockResolvedValue([])

    await queryActivities('testuser', ['exercise', 'sleep', 'meditation'], new Date('2024-01-14'), new Date('2024-01-16'))

    // Should fire heart_rate ONCE and hrv_rmssd ONCE — not once per activity.
    const calls = vi.mocked(db.getTimeSeries).mock.calls
    const hrCalls = calls.filter(([, metric]) => metric === 'heart_rate')
    const hrvCalls = calls.filter(([, metric]) => metric === 'hrv_rmssd')
    expect(hrCalls).toHaveLength(1)
    expect(hrvCalls).toHaveLength(1)
  })
})
