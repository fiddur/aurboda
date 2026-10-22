/**
 * Re-federate the shares of an activity that changed after it was shared —
 * its detail (GPS, per-second HR, distance) landing, or any later edit, merge
 * or re-sync that changed the row: bump each post's version and send it as an
 * Update, so remote servers re-read the scalars and re-download the attachments
 * (their URLs carry that version).
 */
import type { Activity, AutoshareCandidate, FeedPostRecord } from '../db/index.ts'
import type { AutoshareRequeue } from './autoshare-queue.ts'

import {
  getActivitiesChangedAt,
  getActivityById,
  getOverlappingActivities,
  listActivityPostVersions,
  listFeedPostIdsByActivityIds,
  listSharedActivities,
  touchFeedPost,
} from '../db/index.ts'
import { getAutoshareGroup } from './autoshare-deps.ts'
import { STABILISATION_SECONDS } from './autoshare.ts'

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

export interface FeedRefreshWindowDeps {
  /** The bounded, non-deleted activities overlapping the window that an activity post references. */
  listSharedActivities: (user: string, start: Date, end: Date) => Promise<AutoshareCandidate[]>
  /** The candidate's whole merge group, earliest-start first (its anchor at [0]). */
  getGroup: (user: string, candidate: AutoshareCandidate) => Promise<AutoshareCandidate[]>
  /** The activity posts referencing any of the activities, with their version. */
  listPostVersions: (user: string, activityIds: string[]) => Promise<{ id: string; updated_at: Date }[]>
  /** When the newest of the activities last changed, or null for none. */
  getChangedAt: (user: string, activityIds: string[]) => Promise<Date | null>
  touchPost: (user: string, id: string) => Promise<FeedPostRecord | null>
  deliverUpdated: (user: string, post: FeedPostRecord) => void
  /** Look at the window again no sooner than `notBefore` (a change in it has not settled yet). */
  requeue?: AutoshareRequeue
}

/**
 * Re-federate every share in a mutation window whose activity group changed
 * after the post's version, once the change has settled. No age limit and no
 * rule involvement: manual shares are refreshed too. Idempotent, since a
 * touched post's version is past the change. Returns how many posts were
 * re-delivered.
 */
export const refreshChangedSharesInWindow = async (
  user: string,
  start: Date,
  end: Date,
  deps: FeedRefreshWindowDeps,
  now: Date = new Date(),
): Promise<number> => {
  const candidates = await deps.listSharedActivities(user, start, end)
  const processedAnchors = new Set<string>()
  let refreshed = 0
  let requeueAt: Date | null = null
  for (const candidate of candidates) {
    const group = await deps.getGroup(user, candidate)
    const anchor = group[0]
    if (anchor == null || processedAnchors.has(anchor.id)) continue
    processedAnchors.add(anchor.id)

    const ids = group.map((member) => member.id)
    const posts = await deps.listPostVersions(user, ids)
    if (posts.length === 0) continue
    const changedAt = await deps.getChangedAt(user, ids)
    if (changedAt == null) continue
    const stale = posts.filter((post) => post.updated_at.getTime() < changedAt.getTime())
    if (stale.length === 0) continue

    const settledAt = new Date(changedAt.getTime() + STABILISATION_SECONDS * 1000)
    if (settledAt > now) {
      if (requeueAt == null || settledAt < requeueAt) requeueAt = settledAt
      continue
    }

    for (const { id } of stale) {
      const post = await deps.touchPost(user, id)
      if (post == null) continue
      deps.deliverUpdated(user, post)
      refreshed++
    }
  }
  if (requeueAt != null) await deps.requeue?.(user, start, end, requeueAt)
  return refreshed
}

/** The production window deps; `deliverUpdated` is `FeedDeliver.updated` from `api.ts`. */
export const createFeedRefreshWindowDeps = (
  deliverUpdated: (user: string, post: FeedPostRecord) => void,
): FeedRefreshWindowDeps => ({
  deliverUpdated,
  getChangedAt: getActivitiesChangedAt,
  getGroup: getAutoshareGroup,
  listPostVersions: listActivityPostVersions,
  listSharedActivities,
  touchPost: touchFeedPost,
})
