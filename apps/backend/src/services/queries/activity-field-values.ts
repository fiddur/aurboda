import type { ActivityFieldValues } from '@aurboda/api-spec'

import { expandActivityTypes, getActivityFieldValues } from '../../db/index.ts'

export const queryActivityFieldValues = async (
  user: string,
  activityType: string,
  field: string,
): Promise<ActivityFieldValues> => {
  const types = await expandActivityTypes(user, [activityType])
  const rows = await getActivityFieldValues(user, types, field)
  return {
    activity_type: activityType,
    field,
    values: rows.map((r) => ({ count: r.count, last_used: r.last_used.toISOString(), value: r.value })),
  }
}
