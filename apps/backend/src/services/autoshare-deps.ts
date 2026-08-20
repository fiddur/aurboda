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
  listFeedPostIdsByActivityIds,
} from '../db/index.ts'
import { expandFeedActivityWindow } from './feed.ts'
import { queryMetricsBucketed } from './queries/index.ts'

/** Map a full activity row (+ known ingest times) back to the evaluator's candidate shape. */
const toCandidate = (
  activity: Activity,
  fallback: AutoshareCandidate,
  ingestTimes: Record<string, Date>,
): AutoshareCandidate => ({
  activity_type: activity.activity_type,
  created_at: (activity.id != null ? ingestTimes[activity.id] : undefined) ?? fallback.created_at,
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
): AutoshareDeps => ({
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
    return members.map((member) => toCandidate(member, candidate, ingestTimes))
  },
  listCandidates: listAutoshareCandidates,
  onCreated: (user, post, anchor) => {
    // Fan out with the REAL activity row (the deliver impl resolves the merged
    // span itself, like the manual share path). Best-effort.
    void getActivityById(user, anchor.id)
      .then((activity) => {
        if (activity != null) deliverCreated(user, post, activity)
      })
      .catch((err: unknown) => console.warn(`⚠️ auto-share delivery lookup failed for ${user}:`, err))
  },
  postIdsForActivities: listFeedPostIdsByActivityIds,
  resolveWindow: async (user, anchor) => {
    const activity = await getActivityById(user, anchor.id)
    // Vanished since grouping: return an open window so the evaluator skips it.
    if (activity == null) return { activity_type: anchor.activity_type, start_time: anchor.start_time }
    return expandFeedActivityWindow(user, activity)
  },
})
