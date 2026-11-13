import type { FeedVisibility, NotificationAction } from '@aurboda/api-spec'

import type { AutoshareCandidate, AutoshareRuleRecord } from '../db/index.ts'
import type { RaiseNotificationInput } from './notifications.ts'

const MINUTE_MS = 60_000

export const AUTOSHARE_SKIP_ACTION: NotificationAction = { key: 'skip', label: "Don't share" }

export const autosharePendingDedupeKey = (activityId: string): string => `autoshare_pending:${activityId}`

/** `strength_training` → `strength training`. */
export const activityLabel = (activityType: string): string =>
  activityType.replaceAll(/[_-]+/g, ' ').trim().toLowerCase()

const visibilityLabels: Record<FeedVisibility, string> = {
  followers: 'Followers only',
  public: 'Public',
  unlisted: 'Unlisted',
}

const shareWhen = (shareAt: Date, now: Date): string => {
  const minutes = Math.ceil((shareAt.getTime() - now.getTime()) / MINUTE_MS)
  if (minutes < 2) return 'in about a minute'
  if (minutes <= 90) return `in about ${minutes} minutes`
  const hours = Math.round(minutes / 60)
  return `in about ${hours} hours`
}

export interface PendingAutoshareInput {
  anchor: Pick<AutoshareCandidate, 'activity_type' | 'id' | 'title'>
  rule: Pick<AutoshareRuleRecord, 'id' | 'name' | 'visibility'>
  share_at: Date
  detail_pending: boolean
  now: Date
}

export const pendingAutoshareNotification = ({
  anchor,
  detail_pending,
  now,
  rule,
  share_at,
}: PendingAutoshareInput): RaiseNotificationInput => {
  const label = activityLabel(anchor.activity_type)
  const title = detail_pending
    ? `Your new ${label} will be shared once its Garmin details have synced`
    : `Your new ${label} will be shared ${shareWhen(share_at, now)}`
  const activityTitle = anchor.title?.trim()
  const body = [activityTitle, `Rule: ${rule.name}`, visibilityLabels[rule.visibility]]
    .filter((part): part is string => part != null && part !== '')
    .join(' · ')
  return {
    actions: [AUTOSHARE_SKIP_ACTION],
    body,
    data: {
      activity_id: anchor.id,
      activity_label: label,
      rule_id: rule.id,
      share_not_before: share_at.toISOString(),
    },
    dedupe_key: autosharePendingDedupeKey(anchor.id),
    link: `/detail/activity/${anchor.id}`,
    title,
    type: 'autoshare_pending',
  }
}

export interface AutoshareRevision {
  title: string
  link?: string
}

export const sharedAutoshareRevision = ({
  activity_label,
  post_id,
  username,
}: {
  activity_label: string
  username: string
  post_id: string
}): AutoshareRevision => ({
  link: `/u/${username}/posts/${post_id}`,
  title: `Your ${activity_label} was shared`,
})

export const skippedAutoshareRevision = (label: string): AutoshareRevision => ({
  title: `Your ${label} will not be shared`,
})
