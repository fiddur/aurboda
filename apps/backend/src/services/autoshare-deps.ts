/**
 * The production wiring behind `evaluateAutoshareWindow` / `previewAutoshareRule`
 * (#903): merge-group resolution via the same `getOverlappingActivities` +
 * `expandFeedActivityWindow` a manual share of a merged activity uses, the
 * shared-scalar distance source, and post creation through the ordinary
 * `createFeedPost` (stamped with the rule id — the "via rule" marker and the
 * dedupe record). Delivery is injected from `api.ts` (the same `FeedDeliver.
 * created` fan-out a manual share fires).
 */
import type { Activity, AutoshareCandidate, FeedPostRecord } from '../db/index.ts'
import type { AutoshareDeps } from './autoshare.ts'

import {
  createFeedPost,
  getActivityById,
  getActivityIngestTimes,
  getEnabledAutoshareRules,
  getOverlappingActivities,
  listAutoshareCandidates,
  listAutoshareSuppressedIds,
  listFeedPostIdsByActivityIds,
} from '../db/index.ts'
import { expandFeedActivityWindow } from './feed.ts'
import { queryMetricsBucketed } from './queries/index.ts'

/** A merge-group member: the evaluator's candidate shape plus the full row it was read from. */
export interface AutoshareGroupMember extends AutoshareCandidate {
  activity: Activity
}

/** Map a full activity row (+ known ingest times) to a group member. */
const toMember = (
  activity: Activity,
  fallback: AutoshareCandidate,
  ingestTimes: Record<string, Date>,
): AutoshareGroupMember => ({
  activity,
  activity_type: activity.activity_type,
  created_at: (activity.id != null ? ingestTimes[activity.id] : undefined) ?? fallback.created_at,
  detail_pending: activity.data?.garmin_activity_id != null && activity.data.detail_synced !== true,
  end_time: activity.end_time ?? fallback.end_time,
  id: activity.id ?? fallback.id,
  source: activity.source ?? null,
  start_time: activity.start_time,
  title: activity.title ?? null,
})

/** Total distance (meters) over a window from the `distance` metric, or undefined when none. */
const windowDistanceMeters = async (user: string, start: Date, end: Date): Promise<number | undefined> => {
  const seconds = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 1000))
  const result = await queryMetricsBucketed(user, ['distance'], start, end, `${seconds}s`, {})
  let sum = 0
  let any = false
  for (const bucket of result.buckets) {
    const value = bucket.metrics.distance?.sum
    if (value != null) {
      sum += value
      any = true
    }
  }
  return any ? sum : undefined
}

/** Build the production `AutoshareDeps`; `deliverCreated` is `FeedDeliver.created` from `api.ts`. */
export const createAutoshareDeps = (
  deliverCreated: (user: string, post: FeedPostRecord, activity: Activity) => void,
): AutoshareDeps<AutoshareGroupMember> => ({
  createPost: (user, anchor, rule) =>
    createFeedPost(user, {
      activity_id: anchor.id,
      autoshare_rule_id: rule.id,
      include_chart: rule.include_chart,
      include_map: rule.include_map,
      included_metrics: rule.included_metrics,
      message: rule.message,
      series_metrics: rule.series_metrics,
      visibility: rule.visibility,
    }),
  distanceMeters: windowDistanceMeters,
  getEnabledRules: getEnabledAutoshareRules,
  getGroup: async (user, candidate) => {
    const activity = await getActivityById(user, candidate.id)
    if (activity == null) return [] // deleted since listing — the evaluator skips
    const group = await getOverlappingActivities(user, activity)
    const members = group.length > 0 ? group : [activity]
    const ids = members.map((member) => member.id).filter((id): id is string => id != null)
    const ingestTimes = await getActivityIngestTimes(user, ids)
    return members.map((member) => toMember(member, candidate, ingestTimes))
  },
  listCandidates: listAutoshareCandidates,
  suppressedActivityIds: listAutoshareSuppressedIds,
  onCreated: (user, post, anchor) => deliverCreated(user, post, anchor.activity),
  postIdsForActivities: listFeedPostIdsByActivityIds,
  resolveWindow: (user, anchor) => expandFeedActivityWindow(user, anchor.activity),
})
