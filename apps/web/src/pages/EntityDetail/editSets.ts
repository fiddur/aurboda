import type { Activity } from '../../state/api'

import { STRENGTH_TYPE } from '../Strength/constants'
import { isInProgress, setsOfData } from '../Strength/sessionModel'

type Row = Pick<Activity, 'id' | 'activity_type' | 'source' | 'data' | 'override_target_ids' | 'deleted_at'>

type DetailRow = Row & Pick<Activity, 'source_records'>

const isOverride = (row: Row): boolean => Boolean(row.override_target_ids?.length)

const isLiveStrength = (row: Row): boolean =>
  row.activity_type === STRENGTH_TYPE && !row.deleted_at && !isInProgress(row.data)

export const aurbodaStrengthMemberId = (activity: DetailRow, merged: boolean): string | undefined => {
  if (!merged || activity.activity_type !== STRENGTH_TYPE || activity.deleted_at) return undefined
  const members = (activity.source_records ?? []).filter((r) => r.source === 'aurboda')
  return members.length === 1 && members[0].activity_type === STRENGTH_TYPE ? members[0].id : undefined
}

/**
 * The row "Edit sets" opens: a plain logged row itself, or on a merged view the group's one
 * `aurboda` row once it is fetched and is a finished logged session that is not an override.
 */
export const editableSetsRowId = (
  activity: DetailRow,
  merged: boolean,
  member: Row | undefined,
): string | null => {
  if (!merged) {
    return isLiveStrength(activity) && activity.source === 'aurboda' && !isOverride(activity)
      ? (activity.id ?? null)
      : null
  }
  const memberId = aurbodaStrengthMemberId(activity, merged)
  if (!memberId || !member || member.id !== memberId) return null
  return isLiveStrength(member) &&
    member.source === 'aurboda' &&
    !isOverride(member) &&
    setsOfData(member.data).length > 0
    ? memberId
    : null
}
