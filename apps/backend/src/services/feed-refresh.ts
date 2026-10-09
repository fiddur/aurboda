/**
 * Re-federate the shares of an activity whose detail (GPS, per-second HR,
 * distance) landed after it was shared: bump each post's version and send it
 * as an Update, so remote servers re-read the scalars and re-download the
 * attachments (their URLs carry that version).
 */
import type { Activity, FeedPostRecord } from '../db/index.ts'

import {
  getActivityById,
  getOverlappingActivities,
  listFeedPostIdsByActivityIds,
  touchFeedPost,
} from '../db/index.ts'

export interface FeedRefreshDeps {
  getActivity: (user: string, id: string) => Promise<Activity | null>
  /** The activity's merge group (empty when it stands alone). */
  getGroup: (user: string, activity: Activity) => Promise<Activity[]>
  /** Ids of the ACTIVITY posts referencing any of the activities — only those carry its detail. */
  activityPostIds: (user: string, activityIds: string[]) => Promise<string[]>
  touchPost: (user: string, id: string) => Promise<FeedPostRecord | null>
  deliverUpdated: (user: string, post: FeedPostRecord) => void
}

/** Returns how many posts were re-delivered. */
export const refreshFeedPostsForActivity = async (
  user: string,
  activityId: string,
  deps: FeedRefreshDeps,
): Promise<number> => {
  const activity = await deps.getActivity(user, activityId)
  if (activity == null) return 0
  const group = await deps.getGroup(user, activity)
  const members = group.length > 0 ? group : [activity]
  const ids = members.map((member) => member.id).filter((id): id is string => id != null)
  const postIds = await deps.activityPostIds(user, ids)
  let refreshed = 0
  for (const postId of postIds) {
    const post = await deps.touchPost(user, postId)
    if (post == null) continue
    deps.deliverUpdated(user, post)
    refreshed++
  }
  return refreshed
}

/** The production deps; `deliverUpdated` is `FeedDeliver.updated` from `api.ts`. */
export const createFeedRefreshDeps = (
  deliverUpdated: (user: string, post: FeedPostRecord) => void,
): FeedRefreshDeps => ({
  deliverUpdated,
  getActivity: getActivityById,
  getGroup: getOverlappingActivities,
  activityPostIds: (user, activityIds) => listFeedPostIdsByActivityIds(user, activityIds, 'activity'),
  touchPost: touchFeedPost,
})
