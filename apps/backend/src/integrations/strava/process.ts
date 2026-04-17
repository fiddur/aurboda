/**
 * Strava data processing — transforms Strava API responses into
 * raw_records, activities, time_series, and locations.
 */

import type {
  insertActivity,
  insertLocations,
  insertRawRecord,
  insertTimeSeries,
  softDeleteLocationRange,
} from '../../db/index.ts'
import type { Activity, Location, RawRecord, TimeSeriesPoint } from '../../db/types.ts'
import type { StravaDetailedActivity, StravaStreamsResponse } from './types.ts'

import { mapStravaSportType } from './sport-type-map.ts'

// GPS: downsample to ~1 point per minute (same as Garmin)
const GPS_DOWNSAMPLE_MS = 60_000

export interface StravaProcessDeps {
  insertActivity: typeof insertActivity
  insertLocations: typeof insertLocations
  insertRawRecord: typeof insertRawRecord
  insertTimeSeries: typeof insertTimeSeries
  softDeleteLocationRange: typeof softDeleteLocationRange
}

const makeRaw = (recordType: string, externalId: string, recordedAt: Date, data: unknown): RawRecord => ({
  data: data as Record<string, unknown>,
  external_id: externalId,
  record_type: recordType,
  recorded_at: recordedAt,
  source: 'strava',
})

/**
 * Process a Strava activity (detail + optional streams) into the database.
 */
export const processStravaActivity = async (
  user: string,
  activity: StravaDetailedActivity,
  streams: StravaStreamsResponse | null,
  deps: StravaProcessDeps,
): Promise<number> => {
  const externalId = `strava-activity-${activity.id}`
  const startTime = new Date(activity.start_date)
  const endTime = new Date(startTime.getTime() + activity.elapsed_time * 1000)
  const activityType = mapStravaSportType(activity.sport_type)

  // Raw record
  await deps.insertRawRecord(user, makeRaw('strava_activity', externalId, startTime, activity))

  // Activity
  const activityRecord: Activity = {
    activity_type: activityType,
    data: {
      average_cadence: activity.average_cadence,
      average_hr: activity.average_heartrate,
      average_speed: activity.average_speed,
      average_watts: activity.average_watts,
      calories: activity.calories,
      distance: activity.distance,
      elapsed_time: activity.elapsed_time,
      elevation_gain: activity.total_elevation_gain,
      max_hr: activity.max_heartrate,
      max_speed: activity.max_speed,
      moving_time: activity.moving_time,
      strava_activity_id: activity.id,
      suffer_score: activity.suffer_score,
    },
    end_time: endTime,
    external_id: externalId,
    source: 'strava',
    start_time: startTime,
    title: activity.name,
  }
  await deps.insertActivity(user, activityRecord)

  let pointCount = 0

  // Process streams (per-second HR, cadence, power, altitude, GPS)
  if (streams) {
    const timeStream = streams.time
    if (timeStream) {
      const timeOffsets = timeStream.data as number[]
      pointCount += await processTimeSeriesStreams(user, startTime, timeOffsets, streams, deps)
      await processGpsStream(user, startTime, timeOffsets, streams, deps)
    }
  }

  return pointCount
}

const streamMetricMap: Record<string, { metric: string; unit: string }> = {
  altitude: { metric: 'elevation', unit: 'm' },
  cadence: { metric: 'cadence', unit: 'rpm' },
  heartrate: { metric: 'heart_rate', unit: 'bpm' },
  temp: { metric: 'body_temperature', unit: 'C' },
  watts: { metric: 'power', unit: 'W' },
}

const processTimeSeriesStreams = async (
  user: string,
  startTime: Date,
  timeOffsets: number[],
  streams: StravaStreamsResponse,
  deps: StravaProcessDeps,
): Promise<number> => {
  const points: TimeSeriesPoint[] = []

  for (const [streamKey, mapping] of Object.entries(streamMetricMap)) {
    const stream = streams[streamKey]
    if (!stream) continue

    const data = stream.data as number[]
    for (let i = 0; i < data.length && i < timeOffsets.length; i++) {
      const value = data[i]
      if (value == null || value === 0) continue

      points.push({
        metric: mapping.metric,
        source: 'strava',
        time: new Date(startTime.getTime() + timeOffsets[i] * 1000),
        unit: mapping.unit,
        value,
      })
    }
  }

  if (points.length > 0) await deps.insertTimeSeries(user, points)
  return points.length
}

const processGpsStream = async (
  user: string,
  startTime: Date,
  timeOffsets: number[],
  streams: StravaStreamsResponse,
  deps: StravaProcessDeps,
): Promise<void> => {
  const latlngStream = streams.latlng
  if (!latlngStream) return

  const latlngData = latlngStream.data as [number, number][]
  const altitudeStream = streams.altitude
  const altitudeData = altitudeStream ? (altitudeStream.data as number[]) : null

  const gpsPoints: Location[] = []
  let lastTime = 0

  for (let i = 0; i < latlngData.length && i < timeOffsets.length; i++) {
    const [lat, lng] = latlngData[i]
    if (lat === 0 && lng === 0) continue

    const timeMs = startTime.getTime() + timeOffsets[i] * 1000
    if (timeMs - lastTime < GPS_DOWNSAMPLE_MS) continue

    gpsPoints.push({
      altitude: altitudeData?.[i],
      lat,
      lon: lng,
      source: 'strava',
      time: new Date(timeMs),
    })
    lastTime = timeMs
  }

  if (gpsPoints.length > 0) {
    const start = gpsPoints[0].time
    const end = gpsPoints[gpsPoints.length - 1].time
    await deps.softDeleteLocationRange(user, 'owntracks', start, end)
    await deps.insertLocations(user, gpsPoints)
  }
}
