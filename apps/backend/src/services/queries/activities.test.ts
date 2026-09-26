import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { queryActivities } from './activities.ts'

vi.mock('../../db', () => ({
  expandActivityTypes: vi.fn().mockImplementation((_user: string, types: string[]) => Promise.resolve(types)),
  getActivities: vi.fn(),
  getActivityTypeDefinitions: vi.fn().mockResolvedValue([]),
  getNotesByEntityIds: vi.fn(),
  getRepliesForRootIds: vi.fn().mockResolvedValue(new Map()),
  getTimeSeries: vi.fn(),
  getTimeSeriesMultiMetric: vi.fn().mockResolvedValue({}),
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

  test('batches heart_rate / summary metrics and hrv_rmssd fetches across activities (no N+1)', async () => {
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
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({})

    await queryActivities(
      'testuser',
      ['exercise', 'sleep', 'meditation'],
      new Date('2024-01-14'),
      new Date('2024-01-16'),
    )

    // Should fire summary-metric multi-fetch ONCE and hrv_rmssd ONCE — not once per activity.
    const multi = vi.mocked(db.getTimeSeriesMultiMetric).mock.calls
    expect(multi).toHaveLength(1)
    const hrvCalls = vi.mocked(db.getTimeSeries).mock.calls.filter(([, metric]) => metric === 'hrv_rmssd')
    expect(hrvCalls).toHaveLength(1)
  })

  test('exposes summary metrics on the activity result (distance, avg pace, body battery)', async () => {
    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activity_type: 'exercise',
        data: { calories: 230, distance: 2671.9, max_hr: 172 },
        end_time: new Date('2024-01-15T10:30:00Z'),
        id: 'ex-1',
        source: 'garmin',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Morning run',
      },
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(new Map())
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({
      body_battery: [
        [new Date('2024-01-15T10:00:00Z'), 78],
        [new Date('2024-01-15T10:29:00Z'), 55],
      ],
      heart_rate: [
        [new Date('2024-01-15T10:05:00Z'), 130],
        [new Date('2024-01-15T10:15:00Z'), 150],
      ],
      speed: [
        [new Date('2024-01-15T10:05:00Z'), 4],
        [new Date('2024-01-15T10:15:00Z'), 5],
      ],
    })

    const result = await queryActivities(
      'testuser',
      ['exercise'],
      new Date('2024-01-15'),
      new Date('2024-01-16'),
    )

    expect(result).toHaveLength(1)
    const a = result[0]
    expect(a.distance).toBe(2671.9)
    expect(a.calories).toBe(230)
    expect(a.max_hr).toBe(172) // from data, not overridden
    expect(a.avg_speed).toBe(4.5)
    expect(a.avg_pace).toBeGreaterThan(0)
    expect(a.body_battery_before).toBe(78)
    expect(a.body_battery_after).toBe(55)
    expect(a.avg_hr).toBe(140) // from time-series since data has no average_hr
  })

  test('HR zones and HRV use the samples inside [start, end], both ends included', async () => {
    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:30:00Z'),
        id: 'ex-1',
        source: 'garmin',
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity_type: 'sleep',
        end_time: new Date('2024-01-15T07:00:00Z'),
        id: 'sl-1',
        source: 'oura',
        start_time: new Date('2024-01-14T23:00:00Z'),
      },
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(new Map())
    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [new Date('2024-01-14T22:59:59.999Z'), 1000],
      [new Date('2024-01-14T23:00:00Z'), 40],
      [new Date('2024-01-15T03:00:00Z'), 50],
      [new Date('2024-01-15T07:00:00Z'), 60],
      [new Date('2024-01-15T07:00:00.001Z'), 1000],
    ])
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({
      heart_rate: [
        [new Date('2024-01-15T09:59:59.999Z'), 180],
        [new Date('2024-01-15T10:00:00Z'), 95],
        [new Date('2024-01-15T10:15:00Z'), 95],
        [new Date('2024-01-15T10:30:00Z'), 170],
        [new Date('2024-01-15T10:30:00.001Z'), 60],
      ],
    })

    const result = await queryActivities(
      'testuser',
      ['exercise', 'sleep'],
      new Date('2024-01-14'),
      new Date('2024-01-16'),
    )

    const exercise = result.find((a) => a.id === 'ex-1')
    // Default zones (1=90 … 5=162): two capped 60 s gaps in zone 1, the last sample's mean gap in zone 5
    expect(exercise?.hr_zone_secs).toEqual({ 0: 0, 1: 120, 2: 0, 3: 0, 4: 0, 5: 60 })
    expect(result.find((a) => a.id === 'sl-1')?.avg_hrv).toBe(50)
  })
})
