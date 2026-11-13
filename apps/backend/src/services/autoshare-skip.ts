import type { NotificationActionHandler } from './notification-actions.ts'

import { sharedAutoshareRevision, skippedAutoshareRevision } from './autoshare-notifications.ts'

export type SkipAutoshareOutcome =
  | { status: 'skipped'; activity_ids: string[] }
  | { status: 'not_found' }
  | { status: 'already_shared'; post_id: string }

export interface SkipAutoshareDeps {
  /** The activity's whole merge group; empty when the activity does not exist. */
  getGroupIds: (user: string, activityId: string) => Promise<string[]>
  insertSuppressions: (user: string, activityIds: string[]) => Promise<void>
  postIdsForActivities: (user: string, activityIds: string[]) => Promise<string[]>
}

export type SkipAutoshare = (user: string, activityId: string) => Promise<SkipAutoshareOutcome>

/**
 * Keeps the activity's merge group from ever being auto-shared. The suppressions go in
 * before the post lookup: an evaluation that shares in between is then seen here as
 * `already_shared`, and one that starts after sees the suppressions.
 */
export const skipAutoshare =
  (deps: SkipAutoshareDeps): SkipAutoshare =>
  async (user, activityId) => {
    const ids = await deps.getGroupIds(user, activityId)
    if (ids.length === 0) return { status: 'not_found' }
    await deps.insertSuppressions(user, ids)
    const [postId] = await deps.postIdsForActivities(user, ids)
    if (postId != null) return { post_id: postId, status: 'already_shared' }
    return { activity_ids: ids, status: 'skipped' }
  }

/**
 * The `skip` action of an `autoshare_pending` notification. An activity deleted meanwhile
 * counts as skipped: it will not be shared either way.
 */
export const autosharePendingSkipHandler =
  (skip: SkipAutoshare): NotificationActionHandler =>
  async (user, notification) => {
    const activityId = notification.data?.activity_id
    const storedLabel = notification.data?.activity_label
    const label = typeof storedLabel === 'string' && storedLabel !== '' ? storedLabel : 'activity'
    if (typeof activityId !== 'string') return { message: 'This notification names no activity', ok: false }
    const outcome = await skip(user, activityId)
    if (outcome.status === 'already_shared') {
      return {
        message: 'This activity was already shared',
        ok: false,
        revision: sharedAutoshareRevision({
          activity_label: label,
          post_id: outcome.post_id,
          username: user,
        }),
      }
    }
    return { ok: true, revision: skippedAutoshareRevision(label) }
  }
