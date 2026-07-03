/**
 * Shared feed business logic used by both the REST `/feed` router and the MCP
 * feed tools (parity), and by the ActivityPub delivery/object/image paths.
 *
 * The one thing every feed surface needs from a stored post is its activity
 * resolved to the **merged span** — the same window the activity detail view and
 * the share dialog present. A feed post stores only `activity_id` (the plain
 * anchor uuid), so resolving the merged window here (via `resolveActivityWindow`,
 * the exact logic the `merged:` detail view uses) keeps three things consistent:
 *
 * - what the user *saw and chose to share* (the merged duration/metrics),
 * - what we *deliver / serve / list* over ActivityPub (the Note's scalars, the
 *   chart/route images), and
 * - what the web feed view shows and offers when editing.
 *
 * Resolving at query time (rather than persisting a denormalised span on the
 * post) means a later edit to the underlying activities stays reflected, per the
 * repo's "reference by id, resolve at query time" principle.
 */
import type { FeedPost } from '@aurboda/api-spec'

import type { Activity, FeedPostRecord } from '../db/index.ts'

import { getActivityById } from '../db/index.ts'
import { resolveActivityWindow } from './queries/index.ts'

/**
 * A feed post's shared activity, resolved for presentation/delivery: the title
 * and type from the anchor row, and the **merged-span** window. Structurally a
 * superset-compatible shape for the ActivityPub `DeliverableActivity`.
 */
export interface ResolvedFeedActivity {
  activity_type: string
  start_time: Date
  end_time?: Date
  title?: string
}

/**
 * Expand an already-fetched activity to its merged span (no refetch). Used on the
 * share path, where the handler already loaded the anchor for its 404 check.
 * A plain (non-overlapping) activity passes through with its own window.
 */
export const expandFeedActivityWindow = async (
  user: string,
  activity: Activity,
): Promise<ResolvedFeedActivity> => {
  const window = await resolveActivityWindow(user, activity, true)
  return {
    activity_type: activity.activity_type,
    end_time: window.end_time,
    start_time: window.start_time,
    title: activity.title,
  }
}

/**
 * Resolve a post's stored `activity_id` to its merged-span activity, or null if
 * the activity is missing/deleted. The single source of the shared window for
 * delivery, the object dispatcher, the outbox, and the rendered images.
 */
export const resolveFeedActivity = async (
  user: string,
  activityId: string,
): Promise<ResolvedFeedActivity | null> => {
  const activity = await getActivityById(user, activityId)
  if (activity == null) return null
  return expandFeedActivityWindow(user, activity)
}

/**
 * Serialise a stored feed post for the owner-facing REST/MCP surface, enriching
 * it with the shared activity's title/type and **merged-span** window resolved
 * at query time. A client can therefore render the post and re-open the share
 * dialog without a second per-post activity fetch (avoids the web feed's N+1).
 */
export const serializeFeedPost = async (user: string, record: FeedPostRecord): Promise<FeedPost> => {
  const activity = record.activity_id ? await resolveFeedActivity(user, record.activity_id) : null
  return {
    activity_end_time: activity?.end_time?.toISOString(),
    activity_id: record.activity_id,
    activity_start_time: activity?.start_time.toISOString(),
    activity_title: activity?.title,
    activity_type: activity?.activity_type,
    created_at: record.created_at.toISOString(),
    id: record.id,
    include_chart: record.include_chart,
    include_map: record.include_map,
    included_metrics: record.included_metrics,
    series_metrics: record.series_metrics,
    updated_at: record.updated_at.toISOString(),
    visibility: record.visibility,
  }
}
