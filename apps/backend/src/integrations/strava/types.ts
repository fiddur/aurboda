/**
 * Strava API response types.
 */

/** Summary activity from GET /athlete/activities */
export interface StravaSummaryActivity {
  id: number
  name: string
  sport_type: string
  type: string
  distance: number
  moving_time: number
  elapsed_time: number
  total_elevation_gain: number
  start_date: string
  start_date_local: string
  timezone: string
  utc_offset: number
  start_latlng: [number, number] | null
  end_latlng: [number, number] | null
  average_speed: number
  max_speed: number
  has_heartrate: boolean
  average_heartrate?: number
  max_heartrate?: number
  average_cadence?: number
  average_watts?: number
  weighted_average_watts?: number
  max_watts?: number
  device_watts?: boolean
  kilojoules?: number
  calories?: number
  average_temp?: number
  suffer_score?: number
  trainer: boolean
  commute: boolean
  manual: boolean
  private: boolean
  gear_id?: string
  device_name?: string
  map?: {
    id: string
    summary_polyline: string | null
    polyline?: string | null
  }
}

/** Detailed activity from GET /activities/{id} */
export interface StravaDetailedActivity extends StravaSummaryActivity {
  description?: string
  calories: number
  laps?: StravaLap[]
  splits_metric?: StravaSplit[]
  splits_standard?: StravaSplit[]
  segment_efforts?: StravaSegmentEffort[]
  gear?: { id: string; name: string; distance: number }
}

export interface StravaLap {
  id: number
  name: string
  elapsed_time: number
  moving_time: number
  start_date: string
  distance: number
  average_speed: number
  max_speed: number
  average_heartrate?: number
  max_heartrate?: number
  lap_index: number
  average_cadence?: number
  average_watts?: number
}

export interface StravaSplit {
  distance: number
  elapsed_time: number
  elevation_difference: number
  moving_time: number
  split: number
  average_speed: number
  average_heartrate?: number
  pace_zone: number
}

export interface StravaSegmentEffort {
  id: number
  name: string
  elapsed_time: number
  moving_time: number
  start_date: string
  distance: number
  average_heartrate?: number
  max_heartrate?: number
}

/** Stream data from GET /activities/{id}/streams */
export interface StravaStream {
  type: string
  data: number[] | [number, number][] | boolean[]
  series_type: 'time' | 'distance'
  original_size: number
  resolution: 'high' | 'medium' | 'low'
}

export type StravaStreamsResponse = Record<string, StravaStream>

/** Webhook event payload */
export interface StravaWebhookEvent {
  object_type: 'activity' | 'athlete'
  object_id: number
  aspect_type: 'create' | 'update' | 'delete'
  owner_id: number
  subscription_id: number
  event_time: number
  updates?: Record<string, string>
}

/** Athlete profile from GET /athlete */
export interface StravaAthleteProfile {
  id: number
  username?: string
  firstname?: string
  lastname?: string
}

/** Token response from POST /oauth/token */
export interface StravaTokenResponse {
  token_type: string
  expires_at: number
  expires_in: number
  refresh_token: string
  access_token: string
  athlete: StravaAthleteProfile
}

/** Rate limit info parsed from response headers */
export interface StravaRateLimitInfo {
  reads_15min: number
  reads_15min_limit: number
  reads_daily: number
  reads_daily_limit: number
}

/** Strava sync queue job data */
export interface StravaSyncJobData {
  user: string
  request_type: 'list_activities' | 'fetch_activity'
  strava_activity_id?: number
  list_params?: {
    before?: number
    after?: number
    page?: number
  }
}
