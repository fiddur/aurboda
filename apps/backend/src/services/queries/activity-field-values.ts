import type { ActivityFieldValues } from '@aurboda/api-spec'

import { expandActivityTypes, getActivityFieldValues } from '../../db/index.ts'
import { resolveFieldValueIdentities } from '../item-value-identities.ts'

export const queryActivityFieldValues = async (
  user: string,
  activityType: string,
  field: string,
): Promise<ActivityFieldValues> => {
  const types = await expandActivityTypes(user, [activityType])
  const rows = await getActivityFieldValues(user, types, field)
  const values = rows.map((r) => ({ count: r.count, last_used: r.last_used.toISOString(), value: r.value }))
  const identities = await resolveFieldValueIdentities(user, activityType, field, values)
  return identities
    ? {
        activity_type: activityType,
        catalog: identities.catalog,
        catalog_version: identities.catalog_version,
        field,
        values: identities.values,
      }
    : { activity_type: activityType, field, values }
}
