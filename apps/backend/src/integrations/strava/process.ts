import type {
  insertActivity,
  insertLocations,
  insertRawRecord,
  insertTimeSeries,
  resolveOrCreateActivityType,
  softDeleteSupersededLocations,
  upsertActivityTrack,
} from '../../db/index.ts'
import type { Activity, Location, RawRecord, TimeSeriesPoint } from '../../db/types.ts'
import type { auditInfo } from '../../services/audit-log.ts'
import type { ActivitySpan } from '../gps-precedence.ts'
import type { StravaDetailedActivity, StravaStreamsResponse } from './types.ts'

import { buildTrack } from '../../services/tracks.ts'
import { activityTrackSources, gpsPrecedenceSpan } from '../gps-precedence.ts'
import { mapStravaSportType } from './sport-type-map.ts'

// `locations` gets ~1 point per minute; the activity track keeps every sample.
const GPS_DOWNSAMPLE_MS = 60_000

export interface StravaProcessDeps {
  auditInfo: typeof auditInfo
  insertActivity: typeof insertActivity
  insertLocations: typeof insertLocations
  insertRawRecord: typeof insertRawRecord
  insertTimeSeries: typeof insertTimeSeries
  resolveOrCreateActivityType: typeof resolveOrCreateActivityType
  softDeleteSupersededLocations: typeof softDeleteSupersededLocations
  upsertActivityTrack: typeof upsertActivityTrack
  onTrackWritten?: (user: string, activityId: string) => void
  onActivityProcessed?: (user: string, result: StravaProcessResult) => void
}

export interface StravaProcessResult {
  activity_id: string
  activity_type: string
  start_time: Date
  end_time: Date
  point_count: number
}

const makeRaw = (recordType: string, externalId: string, recordedAt: Date, data: unknown): RawRecord => ({
  data: data as Record<string, unknown>,
  external_id: externalId,
  record_type: recordType,
  recorded_at: recordedAt,
  source: 'strava',
})

export const processStravaActivity = async (
  user: string,
  activity: StravaDetailedActivity,
  streams: StravaStreamsResponse | null,
  deps: StravaProcessDeps,
): Promise<StravaProcessResult> => {
  const externalId = `strava-activity-${activity.id}`
  const startTime = new Date(activity.start_date)
  const endTime = new Date(startTime.getTime() + activity.elapsed_time * 1000)
  const mappedType = mapStravaSportType(activity.sport_type)
  const activityType = await deps.resolveOrCreateActivityType(user, mappedType, 'exercise')

  await deps.insertRawRecord(user, makeRaw('strava_activity', externalId, startTime, activity))

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
  const activityId = await deps.insertActivity(user, activityRecord)

  let pointCount = 0

  if (streams) {
    const timeStream = streams.time
    if (timeStream) {
      const timeOffsets = timeStream.data as number[]
      pointCount += await processTimeSeriesStreams(user, startTime, timeOffsets, streams, deps)
      await processGpsStream(user, { end: endTime, start: startTime }, timeOffsets, streams, deps)
      // insertActivity yields no id when the row was soft-deleted; nothing to attach a track to.
      if (activityId) await writeStravaTrack(user, activityId, startTime, timeOffsets, streams, deps)
    }
  }

  return {
    activity_id: activityId,
    activity_type: activityType,
    end_time: endTime,
    point_count: pointCount,
    start_time: startTime,
  }
}

const writeStravaTrack = async (
  user: string,
  activityId: string,
  startTime: Date,
  timeOffsets: number[],
  streams: StravaStreamsResponse,
  deps: StravaProcessDeps,
): Promise<void> => {
  const latlngData = streams.latlng?.data as [number, number][] | undefined
  if (!latlngData) return
  const altitudeData = streams.altitude?.data as number[] | undefined

  const points = latlngData.slice(0, timeOffsets.length).map(([lat, lon], i) => ({
    alt: altitudeData?.[i] ?? null,
    lat,
    lon,
    time: new Date(startTime.getTime() + timeOffsets[i] * 1000),
  }))
  const track = buildTrack(points, startTime)
  if (!track) return

  await deps.upsertActivityTrack(user, {
    activity_id: activityId,
    ewkt: track.ewkt,
    full_resolution: true,
    source: 'strava',
  })
  deps.onTrackWritten?.(user, activityId)
}

const streamMetricMap: Record<string, { metric: string; unit: string }> = {
  altitude: { metric: 'elevation', unit: 'm' },
  cadence: { metric: 'cadence', unit: 'rpm' },
  heartrate: { metric: 'heart_rate', unit: 'bpm' },
  temp: { metric: 'ambient_temperature', unit: 'C' },
  velocity_smooth: { metric: 'speed', unit: 'm/s' },
  watts: { metric: 'power', unit: 'W' },
}

// Zero means "no data" for heartrate and cadence, but is valid for
// altitude (sea level), watts (coasting), and temp (freezing).
const zeroMeansNoData = new Set(['heartrate', 'cadence'])

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
      if (value == null) continue
      if (value === 0 && zeroMeansNoData.has(streamKey)) continue

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
  activitySpan: ActivitySpan,
  timeOffsets: number[],
  streams: StravaStreamsResponse,
  deps: StravaProcessDeps,
): Promise<void> => {
  const latlngStream = streams.latlng
  if (!latlngStream) return

  const startTime = activitySpan.start

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
    // Strava GPS is higher-resolution than phone tracking during activities —
    // supersede the coarser data for the activity's whole span
    const span = gpsPrecedenceSpan(gpsPoints, activitySpan)
    const replaced = span
      ? await deps.softDeleteSupersededLocations(user, activityTrackSources, span.start, span.end)
      : 0
    await deps.insertLocations(user, gpsPoints)

    if (span && replaced > 0) {
      deps.auditInfo(
        user,
        'sync',
        `🛰️ Strava GPS took precedence over ${replaced} location point(s) from other sources`,
        { end: span.end.toISOString(), start: span.start.toISOString() },
      )
    }
  }
}
