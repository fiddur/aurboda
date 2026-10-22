import type { ActivityNeighbor, ActivityNeighbors } from '@aurboda/api-spec'

import type { Activity } from '../../db/types.ts'

import { findAdjacentActivity, getActivityById, getOverlappingActivities } from '../../db/index.ts'
import { parseActivityId } from './activity-detail.ts'
import { fieldValue } from './activity-sessions.ts'

/** The activity's cross-source merge group, earliest first; just the activity when it stands alone. */
const mergeGroup = async (user: string, activity: Activity): Promise<Activity[]> => {
  if (activity.deleted_at) return [activity]
  const group = await getOverlappingActivities(user, activity)
  return group.length > 0 ? group : [activity]
}

/** Links the way the activity lists do: `merged:<earliest id>` for a merged group, the plain id otherwise. */
const toNeighbor = async (user: string, activity: Activity): Promise<ActivityNeighbor> => {
  const group = await mergeGroup(user, activity)
  const ends = group.flatMap((a) => (a.end_time ? [a.end_time.getTime()] : []))
  return {
    end_time: ends.length > 0 ? new Date(Math.max(...ends)).toISOString() : undefined,
    id: group.length > 1 ? `merged:${group[0]!.id}` : activity.id!,
    start_time: group[0]!.start_time.toISOString(),
    title: group.find((a) => a.title)?.title,
  }
}

/**
 * The activities of the same type just before and after `rawId` (a plain or `merged:` id),
 * stepping over the rest of its merge group. With `sameField`, only activities whose data field
 * equals this one's; none when this one has no value for it. Null when the activity doesn't exist.
 */
export const getActivityNeighbors = async (
  user: string,
  rawId: string,
  sameField?: string,
): Promise<ActivityNeighbors | null> => {
  const activity = await getActivityById(user, parseActivityId(rawId).id, true)
  if (!activity) return null

  const group = await mergeGroup(user, activity)
  const start = group[0]!.start_time
  const data = group.reduce<Record<string, unknown>>((acc, a) => ({ ...acc, ...a.data }), {})

  let filters: { field: string; value: string }[] | undefined
  if (sameField) {
    const value = fieldValue(data[sameField])
    if (value === undefined) return { activity_type: activity.activity_type }
    filters = [{ field: sameField, value: String(value) }]
  }

  const excludeIds = group.map((a) => a.id!)
  const [previous, next] = await Promise.all(
    (['previous', 'next'] as const).map((direction) =>
      findAdjacentActivity(user, activity.activity_type, direction, start, excludeIds, filters),
    ),
  )

  return {
    activity_type: activity.activity_type,
    next: next ? await toNeighbor(user, next) : undefined,
    previous: previous ? await toNeighbor(user, previous) : undefined,
  }
}
