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
import { resolveActivityScalars } from './activitypub/feed-activity.ts'
import { feedPostContent, formatActivityWindow } from './activitypub/object.ts'
import { assembleStructuredActivity, resolveStructuredSeries } from './feed-structured-activity.ts'
import { resolveActivityWindow } from './queries/index.ts'
import { getSettings } from './settings.ts'

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
 * Normalize a request's `message` for storage: `undefined` stays `undefined`
 * (a PATCH leaves the stored value unchanged), a whitespace-only string becomes
 * `null` (clears it), anything else is stored trimmed. Shared by the REST
 * router and the MCP tools so both surfaces behave identically.
 */
export const normalizeFeedMessage = (message?: string): string | null | undefined => {
  if (message === undefined) return undefined
  const trimmed = message.trim()
  return trimmed === '' ? null : trimmed
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
 * it with the shared activity's title/type, the **merged-span** window, and the
 * exact `content` HTML the post federates with — all resolved at query time. A
 * client can therefore render the post WYSIWYG (as it appears on Mastodon) and
 * re-open the share dialog without a second per-post activity fetch.
 *
 * The `content` is the same server-built, HTML-escaped string the delivered Note
 * carries (via `feedPostContent`), so the web renders it directly. (When the feed
 * later renders *remote* actors' posts, that untrusted content will need
 * sanitising — this owner-facing content does not.)
 */
/**
 * The presentation pieces derived from a post's resolved activity: the
 * federated `content` HTML, the typed scalar `metrics`, and (opt-in) the FULL
 * structured payload — assembled by the same helper the public structured
 * endpoint uses, so the author's own card renders exactly what a subscribing
 * Aurboda peer's timeline renders (#1008). `structured` is off by default:
 * the public profile listing and MCP tools don't need the series weight.
 */
const resolveActivityPresentation = async (
  user: string,
  record: FeedPostRecord,
  activity: ResolvedFeedActivity,
  includeStructured: boolean,
): Promise<Pick<FeedPost, 'content' | 'metrics' | 'structured'>> => {
  const scalars = await resolveActivityScalars(
    user,
    { end_time: activity.end_time, start_time: activity.start_time },
    record.included_metrics,
  )
  const settings = await getSettings(user).catch(() => null)
  const content = feedPostContent(activity.title, activity.activity_type, scalars, {
    message: record.message ?? undefined,
    windowLabel: formatActivityWindow(
      activity.start_time,
      activity.end_time,
      settings?.device_timezone ?? undefined,
    ),
  }).content
  let structured: FeedPost['structured']
  if (includeStructured && record.kind === 'activity') {
    const series = activity.end_time
      ? await resolveStructuredSeries(user, record.series_metrics, activity.start_time, activity.end_time)
      : []
    structured = assembleStructuredActivity(activity, scalars, series, record.message)
  }
  return {
    content,
    // The typed scalar values (same shape as the structured-enrichment payload),
    // so the web renders a native stat grid instead of parsing the content HTML.
    metrics: scalars.map(({ key, unit, value }) => ({
      key,
      value,
      ...(unit === undefined ? {} : { unit }),
    })),
    structured,
  }
}

export const serializeFeedPost = async (
  user: string,
  record: FeedPostRecord,
  opts: { includeStructured?: boolean } = {},
): Promise<FeedPost> => {
  const activity = record.activity_id ? await resolveFeedActivity(user, record.activity_id) : null
  const { content, metrics, structured } = activity
    ? await resolveActivityPresentation(user, record, activity, opts.includeStructured ?? false)
    : { content: undefined, metrics: undefined, structured: undefined }
  return {
    activity_end_time: activity?.end_time?.toISOString(),
    activity_id: record.activity_id,
    activity_start_time: activity?.start_time.toISOString(),
    activity_title: activity?.title,
    activity_type: activity?.activity_type,
    // The stored article payload (title + default window + blocks); present only
    // for `article` posts, which carry no activity and so no resolved `content`.
    article: record.article ?? undefined,
    content,
    created_at: record.created_at.toISOString(),
    id: record.id,
    include_chart: record.include_chart,
    include_map: record.include_map,
    included_metrics: record.included_metrics,
    kind: record.kind,
    message: record.message ?? undefined,
    metrics,
    series_metrics: record.series_metrics,
    structured,
    updated_at: record.updated_at.toISOString(),
    visibility: record.visibility,
  }
}
