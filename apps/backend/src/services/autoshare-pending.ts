import type { FeedPostRecord } from '../db/index.ts'
import type { Notifier } from './notifications.ts'

import { getActivityById, getOverlappingActivities, listOpenNotifications } from '../db/index.ts'
import {
  activityLabel,
  autosharePendingDedupeKey,
  sharedAutoshareRevision,
  skippedAutoshareRevision,
} from './autoshare-notifications.ts'
import { notifier as defaultNotifier } from './notifications.ts'

type OpenRevisingNotifier = Pick<Notifier, 'reviseOpen'>

/** The ids of the activity's whole merge group (as `getAutoshareGroup` resolves it); empty when it does not exist. */
export const getAutoshareGroupIds = async (user: string, activityId: string): Promise<string[]> => {
  const activity = await getActivityById(user, activityId)
  if (activity == null) return []
  const group = await getOverlappingActivities(user, activity)
  const members = group.length > 0 ? group : [activity]
  return members.map((member) => member.id).filter((id): id is string => id != null)
}

const bestEffort = async (what: string, user: string, run: () => Promise<unknown>): Promise<void> => {
  try {
    await run()
  } catch (error) {
    console.error(`⚠️ auto-share ${what} failed for ${user}:`, error)
  }
}

/**
 * A rule was disabled or deleted: its open pending-share notifications now say the share is off.
 * Their dedupe keys are freed, so a later match under another rule announces afresh.
 */
export const withdrawRuleAutoshares = (
  user: string,
  ruleId: string,
  notifier: OpenRevisingNotifier = defaultNotifier,
): Promise<void> =>
  bestEffort('rule withdrawal', user, async () => {
    const open = await listOpenNotifications(user, 'autoshare_pending', { rule_id: ruleId })
    const keysByLabel = new Map<string, string[]>()
    for (const row of open) {
      if (row.dedupe_key == null) continue
      const stored = row.data?.activity_label
      const label = typeof stored === 'string' && stored !== '' ? stored : 'activity'
      keysByLabel.set(label, [...(keysByLabel.get(label) ?? []), row.dedupe_key])
    }
    for (const [label, keys] of keysByLabel) {
      await notifier.reviseOpen(user, keys, {
        ...skippedAutoshareRevision(label),
        actions: [],
        release_dedupe_key: true,
      })
    }
  })

/** A post made by hand for an activity: its merge group's open pending-share notification now says it was shared. */
export const autoshareSharedByHand = (
  user: string,
  post: Pick<FeedPostRecord, 'activity_id' | 'id'>,
  activityType: string,
  notifier: OpenRevisingNotifier = defaultNotifier,
): Promise<void> =>
  bestEffort('manual share revision', user, async () => {
    if (post.activity_id == null) return
    const ids = await getAutoshareGroupIds(user, post.activity_id)
    const revision = sharedAutoshareRevision({
      activity_label: activityLabel(activityType),
      post_id: post.id,
      username: user,
    })
    await notifier.reviseOpen(user, ids.map(autosharePendingDedupeKey), { ...revision, actions: [] })
  })
