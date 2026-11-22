import type { ResyncActivityDetailResponse } from '@aurboda/api-spec'

import type { ResyncActivityDetailFn, ResyncDetailResult } from '../integrations/garmin/sync.ts'

import { getActivityById, getOverlappingActivities } from '../db/index.ts'

export type ResyncGarminActivityDetailOutcome =
  | ResyncDetailResult
  | { status: 'not_configured' }
  | { status: 'not_found' }
  | { status: 'no_garmin_id' }

const garminActivityIdOf = (a: { data?: Record<string, unknown> }): number | undefined => {
  const garminId = a.data?.garmin_activity_id
  return typeof garminId === 'number' ? garminId : undefined
}

/** Fetches one activity's Garmin detail again, from the activity itself or the merged source that carries the Garmin id. */
export const resyncGarminActivityDetail = async (
  user: string,
  id: string,
  resync: ResyncActivityDetailFn | undefined,
): Promise<ResyncGarminActivityDetailOutcome> => {
  if (!resync) return { status: 'not_configured' }
  const activity = await getActivityById(user, id)
  if (!activity) return { status: 'not_found' }

  let source = activity
  let garminActivityId = garminActivityIdOf(activity)
  if (!garminActivityId) {
    for (const overlapping of await getOverlappingActivities(user, activity)) {
      const gid = garminActivityIdOf(overlapping)
      if (gid) {
        garminActivityId = gid
        source = overlapping
        break
      }
    }
  }
  if (!garminActivityId) return { status: 'no_garmin_id' }

  // The span of the row that supplied the Garmin id, not the merge wrapper's; null without an
  // end_time, so the track's own range is used rather than a start-only span.
  return resync(
    user,
    source.id!,
    garminActivityId,
    source.end_time ? { end: source.end_time, start: source.start_time } : null,
    source.start_time,
  )
}

const ERRORS: Record<Exclude<ResyncGarminActivityDetailOutcome['status'], 'synced'>, [number, string]> = {
  failed: [502, 'Garmin did not return the activity. The audit log has the reason.'],
  no_connection: [
    409,
    'Re-syncing needs the Garmin Connect login or a Personal API key that Garmin accepts. Connect with Garmin only receives what Garmin sends, so it cannot fetch an activity again.',
  ],
  no_file: [404, 'Garmin has no activity file for this activity.'],
  no_garmin_id: [400, 'No Garmin activity ID found in activity or its merged sources'],
  not_configured: [501, 'Garmin sync not configured'],
  not_found: [404, 'Activity not found'],
}

/** The answer to a re-sync, as the REST route sends it; the MCP tool answers the same body. */
export const resyncDetailAnswer = (
  outcome: ResyncGarminActivityDetailOutcome,
): { http_status: number; body: ResyncActivityDetailResponse } => {
  if (outcome.status === 'synced') {
    return { body: { points: outcome.points, success: true }, http_status: 200 }
  }
  const [http_status, error] = ERRORS[outcome.status]
  return { body: { error, points: 0, success: false }, http_status }
}
