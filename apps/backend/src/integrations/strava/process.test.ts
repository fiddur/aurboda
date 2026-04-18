import { describe, expect, test, vi } from 'vitest'

import type { StravaProcessDeps } from './process.ts'
import type { StravaDetailedActivity, StravaStreamsResponse } from './types.ts'

import { processStravaActivity } from './process.ts'

const createMockDeps = (): StravaProcessDeps => ({
  insertActivity: vi.fn(),
  insertLocations: vi.fn(),
  insertRawRecord: vi.fn(),
  insertTimeSeries: vi.fn(),
  resolveOrCreateActivityType: vi.fn(async (_user: string, name: string) => name),
  softDeleteLocationRange: vi.fn(),
})

const baseActivity: StravaDetailedActivity = {
  average_cadence: 85,
  average_heartrate: 145,
  average_speed: 3.2,
  average_temp: 18,
  calories: 450,
  commute: false,
  device_name: 'Garmin Forerunner',
  distance: 10000,
  elapsed_time: 3600,
  end_latlng: [59.33, 18.07],
  has_heartrate: true,
  id: 12345,
  kilojoules: 500,
  manual: false,
  max_heartrate: 170,
  max_speed: 4.5,
  moving_time: 3500,
  name: 'Morning Run',
  private: false,
  sport_type: 'Run',
  start_date: '2024-06-15T07:00:00Z',
  start_date_local: '2024-06-15T09:00:00+02:00',
  start_latlng: [59.32, 18.06],
  suffer_score: 75,
  timezone: '(GMT+02:00) Europe/Stockholm',
  total_elevation_gain: 120,
  trainer: false,
  type: 'Run',
  utc_offset: 7200,
}

describe('processStravaActivity', () => {
  test('creates raw record, activity, and returns 0 with no streams', async () => {
    const deps = createMockDeps()
    const count = await processStravaActivity('testuser', baseActivity, null, deps)

    expect(deps.insertRawRecord).toHaveBeenCalledWith(
      'testuser',
      expect.objectContaining({
        external_id: 'strava-activity-12345',
        record_type: 'strava_activity',
        source: 'strava',
      }),
    )

    expect(deps.insertActivity).toHaveBeenCalledWith(
      'testuser',
      expect.objectContaining({
        activity_type: 'running',
        external_id: 'strava-activity-12345',
        source: 'strava',
        title: 'Morning Run',
      }),
    )

    // Verify activity data fields
    const activityArg = vi.mocked(deps.insertActivity).mock.calls[0][1]
    expect(activityArg.data).toMatchObject({
      average_hr: 145,
      calories: 450,
      distance: 10000,
      max_hr: 170,
      strava_activity_id: 12345,
    })

    expect(count).toBe(0)
    expect(deps.insertTimeSeries).not.toHaveBeenCalled()
    expect(deps.insertLocations).not.toHaveBeenCalled()
  })

  test('processes heart rate stream into time series', async () => {
    const deps = createMockDeps()
    const streams: StravaStreamsResponse = {
      heartrate: {
        data: [140, 145, 150],
        original_size: 3,
        resolution: 'high',
        series_type: 'time',
        type: 'heartrate',
      },
      time: {
        data: [0, 1, 2],
        original_size: 3,
        resolution: 'high',
        series_type: 'time',
        type: 'time',
      },
    }

    const count = await processStravaActivity('testuser', baseActivity, streams, deps)

    expect(count).toBe(3)
    expect(deps.insertTimeSeries).toHaveBeenCalledWith(
      'testuser',
      expect.arrayContaining([
        expect.objectContaining({
          metric: 'heart_rate',
          source: 'strava',
          unit: 'bpm',
          value: 140,
        }),
      ]),
    )
  })

  test('processes GPS stream with downsampling', async () => {
    const deps = createMockDeps()

    // Create GPS points at 1-second intervals (only first should be kept due to 60s downsample)
    const latlngData: [number, number][] = []
    const timeData: number[] = []
    for (let i = 0; i < 120; i++) {
      latlngData.push([59.32 + i * 0.0001, 18.06 + i * 0.0001])
      timeData.push(i)
    }

    const streams: StravaStreamsResponse = {
      latlng: {
        data: latlngData,
        original_size: 120,
        resolution: 'high',
        series_type: 'time',
        type: 'latlng',
      },
      time: {
        data: timeData,
        original_size: 120,
        resolution: 'high',
        series_type: 'time',
        type: 'time',
      },
    }

    await processStravaActivity('testuser', baseActivity, streams, deps)

    expect(deps.softDeleteLocationRange).toHaveBeenCalled()
    expect(deps.insertLocations).toHaveBeenCalled()

    // With 120 seconds of data and 60s downsampling, expect 2 GPS points (at 0s and 60s)
    const locations = vi.mocked(deps.insertLocations).mock.calls[0][1]
    expect(locations).toHaveLength(2)
    expect(locations[0]).toMatchObject({ lat: 59.32, source: 'strava' })
  })

  test('skips zero heartrate/cadence but keeps zero altitude/watts/temp', async () => {
    const deps = createMockDeps()
    const streams: StravaStreamsResponse = {
      altitude: {
        data: [0, 50, 100],
        original_size: 3,
        resolution: 'high',
        series_type: 'time',
        type: 'altitude',
      },
      heartrate: {
        data: [0, 145, 0],
        original_size: 3,
        resolution: 'high',
        series_type: 'time',
        type: 'heartrate',
      },
      time: {
        data: [0, 1, 2],
        original_size: 3,
        resolution: 'high',
        series_type: 'time',
        type: 'time',
      },
      watts: {
        data: [0, 200, 0],
        original_size: 3,
        resolution: 'high',
        series_type: 'time',
        type: 'watts',
      },
    }

    const count = await processStravaActivity('testuser', baseActivity, streams, deps)
    // heartrate: 1 (skips two zeros), altitude: 3 (keeps zeros), watts: 3 (keeps zeros)
    expect(count).toBe(7)
  })

  test('maps sport types correctly', async () => {
    const deps = createMockDeps()
    const bikeActivity = { ...baseActivity, sport_type: 'VirtualRide' }

    await processStravaActivity('testuser', bikeActivity, null, deps)

    expect(deps.insertActivity).toHaveBeenCalledWith(
      'testuser',
      expect.objectContaining({
        activity_type: 'biking_stationary',
      }),
    )
  })

  test('processes altitude stream', async () => {
    const deps = createMockDeps()
    const streams: StravaStreamsResponse = {
      altitude: {
        data: [100, 105, 110],
        original_size: 3,
        resolution: 'high',
        series_type: 'time',
        type: 'altitude',
      },
      time: {
        data: [0, 1, 2],
        original_size: 3,
        resolution: 'high',
        series_type: 'time',
        type: 'time',
      },
    }

    const count = await processStravaActivity('testuser', baseActivity, streams, deps)
    expect(count).toBe(3)

    const points = vi.mocked(deps.insertTimeSeries).mock.calls[0][1]
    expect(points[0]).toMatchObject({
      metric: 'elevation',
      unit: 'm',
      value: 100,
    })
  })
})
