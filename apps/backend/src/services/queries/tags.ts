/**
 * Tag query functions.
 */

import type { SyncProvider, TagSummary } from './types.ts'

import { getActivitiesExcludingCategories } from '../../db/index.ts'
import { getCommentsMap } from './types.ts'

export const queryTagActivities = (user: string, start: Date, end: Date) =>
  getActivitiesExcludingCategories(user, ['sleep_rest', 'exercise'], start, end)

/**
 * Query tags for a time range.
 * Kept for MCP query_tags tool backward compat. Queries activities, not legacy tags table.
 * @param sync Optional sync provider to auto-refresh stale data before querying
 */
export async function queryTags(
  user: string,
  start: Date,
  end: Date,
  sync?: SyncProvider,
): Promise<TagSummary[]> {
  // Fire-and-forget: trigger background sync so data is fresh for the next request
  if (sync) {
    void Promise.all([
      sync.syncOuraIfNeeded(user, 'tags'),
      sync.syncCalendarsIfNeeded(user),
      sync.syncLastFmIfNeeded(user),
    ])
  }

  const tags = await queryTagActivities(user, start, end)
  const ids = tags.map((t) => t.id).filter((id): id is string => id !== undefined)
  const commentsMap = await getCommentsMap(user, 'activity', ids)
  return tags.map((t) => ({
    comments: t.id ? (commentsMap.get(t.id) ?? []) : [],
    end_time: t.end_time?.toISOString(),
    external_id: t.external_id,
    id: t.id,
    source: t.source,
    start_time: t.start_time.toISOString(),
    tag: t.title ?? t.activity_type,
  }))
}
