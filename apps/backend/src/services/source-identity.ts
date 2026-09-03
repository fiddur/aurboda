/**
 * Source identity for activities that reach us through more than one path (#1080).
 *
 * A Health Connect session written by an app we also sync directly (Garmin
 * Connect, Gravl) carries that app's own id in `metadata.clientRecordId`. We
 * use it to store the session under the *provider's* identity — same `source`
 * and `external_id` the provider sync itself writes — so the later provider
 * sync upserts onto the same row and enriches it instead of adding a duplicate.
 *
 * Everything here is pure: the id formats are the contract shared by the HC
 * processor, the Garmin and Gravl processors, and the enrichment queue.
 */

import type { LegacyMatch } from '../db/types.ts'

export type { LegacyMatch }

export const GARMIN_HC_ORIGIN = 'com.garmin.android.apps.connectmobile'
export const GRAVL_HC_ORIGIN = 'com.liteup.getgains'

const GRAVL_CLIENT_RECORD_PREFIX = 'gravl-session-'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const garminActivityExternalId = (activityId: number | string): string =>
  `garmin-activity-${activityId}`
export const garminSleepExternalId = (calendarDate: string): string => `garmin-sleep-${calendarDate}`
export const gravlWorkoutExternalId = (workoutId: string): string =>
  `gravl-workout-${workoutId.toLowerCase()}`

export type SourceProvider = 'garmin' | 'gravl'
export type SourceKind = 'activity' | 'sleep'

export interface SourceIdentity {
  provider: SourceProvider
  kind: SourceKind
  /** The provider-native key: Garmin activityId, Gravl workout uuid, or a sleep calendar date. */
  key: string
  source: SourceProvider
  external_id: string
  /** Fields the provider sync relies on (e.g. `garmin_activity_id` for detail fetches). */
  data: Record<string, unknown>
  legacy: LegacyMatch[]
}

/** What the HC upload route hands to the enrichment queue after a batch lands. */
export interface SourceArrival {
  provider: SourceProvider
  kind: SourceKind
  key: string
}

const metadataOf = (data: Record<string, unknown>): { dataOrigin?: string; clientRecordId?: string } => {
  const metadata = data.metadata
  if (typeof metadata !== 'object' || metadata === null) return {}
  const { dataOrigin, clientRecordId } = metadata as Record<string, unknown>
  return {
    clientRecordId: typeof clientRecordId === 'string' ? clientRecordId : undefined,
    dataOrigin: typeof dataOrigin === 'string' ? dataOrigin : undefined,
  }
}

/** Offset in ms encoded in an ISO timestamp (`+02:00`, `-05:30`, `Z`); null when absent. */
export const isoOffsetMs = (iso: string): number | null => {
  if (/(?:Z|z)$/.test(iso)) return 0
  const match = /([+-])(\d{2}):?(\d{2})$/.exec(iso)
  if (!match) return null
  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60_000
}

/**
 * Calendar date (YYYY-MM-DD) of an epoch instant in the zone whose offset the
 * HC record's own timestamps carry. Garmin keys sleep by local midnight of the
 * calendar date, so `clientRecordId + offset` lands exactly on that date.
 */
export const localCalendarDate = (epochMs: number, offsetMs: number): string =>
  new Date(epochMs + offsetMs).toISOString().slice(0, 10)

const garminExerciseIdentity = (
  data: Record<string, unknown>,
  clientRecordId: string,
): SourceIdentity | null => {
  if (!/^\d+$/.test(clientRecordId)) return null
  const activityId = Number(clientRecordId)
  if (!Number.isSafeInteger(activityId)) return null
  return {
    data: { garmin_activity_id: activityId },
    external_id: garminActivityExternalId(activityId),
    key: clientRecordId,
    kind: 'activity',
    legacy: [
      { garmin_activity_id: activityId, kind: 'garmin_activity_id' },
      { client_record_id: clientRecordId, data_origin: GARMIN_HC_ORIGIN, kind: 'hc_client_record' },
    ],
    provider: 'garmin',
    source: 'garmin',
  }
}

const garminSleepIdentity = (
  data: Record<string, unknown>,
  clientRecordId: string,
): SourceIdentity | null => {
  if (!/^\d+$/.test(clientRecordId)) return null
  if (typeof data.startTime !== 'string') return null
  const startTime = data.startTime
  const offset = isoOffsetMs(startTime)
  if (offset === null) return null
  const calendarDate = localCalendarDate(Number(clientRecordId), offset)
  return {
    data: {},
    external_id: garminSleepExternalId(calendarDate),
    key: calendarDate,
    kind: 'sleep',
    legacy: [
      {
        activity_type: 'sleep',
        kind: 'source_type_start',
        source: 'garmin',
        start_time: new Date(startTime),
      },
      { client_record_id: clientRecordId, data_origin: GARMIN_HC_ORIGIN, kind: 'hc_client_record' },
    ],
    provider: 'garmin',
    source: 'garmin',
  }
}

const gravlIdentity = (clientRecordId: string): SourceIdentity | null => {
  if (!clientRecordId.startsWith(GRAVL_CLIENT_RECORD_PREFIX)) return null
  const workoutId = clientRecordId.slice(GRAVL_CLIENT_RECORD_PREFIX.length)
  if (!UUID_RE.test(workoutId)) return null
  return {
    data: { gravl_workout_id: workoutId.toLowerCase() },
    external_id: gravlWorkoutExternalId(workoutId),
    key: workoutId.toLowerCase(),
    kind: 'activity',
    legacy: [{ client_record_id: clientRecordId, data_origin: GRAVL_HC_ORIGIN, kind: 'hc_client_record' }],
    provider: 'gravl',
    source: 'gravl',
  }
}

/**
 * Identity a Health Connect record should be stored under, or null for the
 * plain `health_connect` identity (unknown origin, or a key we can't parse).
 */
export const resolveHealthConnectIdentity = (
  recordType: string,
  data: Record<string, unknown>,
): SourceIdentity | null => {
  const { dataOrigin, clientRecordId } = metadataOf(data)
  if (!dataOrigin || !clientRecordId) return null

  if (dataOrigin === GARMIN_HC_ORIGIN) {
    if (recordType === 'ExerciseSessionRecord') return garminExerciseIdentity(data, clientRecordId)
    if (recordType === 'SleepSessionRecord') return garminSleepIdentity(data, clientRecordId)
    return null
  }
  if (dataOrigin === GRAVL_HC_ORIGIN && recordType === 'ExerciseSessionRecord') {
    return gravlIdentity(clientRecordId)
  }
  return null
}

/** The Gravl workout id an HC record points at, if it is a Gravl session. */
export const gravlWorkoutIdFromClientRecord = (clientRecordId: string): string | null =>
  gravlIdentity(clientRecordId)?.key ?? null

export const toArrival = (identity: SourceIdentity): SourceArrival => ({
  key: identity.key,
  kind: identity.kind,
  provider: identity.provider,
})
