import type { SharedExercise } from '@aurboda/api-spec'

import { getActivityTypeDefinition, type SharedExerciseRecord } from '../db/index.ts'
import { categoricalItemPath } from './item-value-aliases.ts'
import { buildShareUrl } from './share-urls.ts'
import { isPublicToVisibility } from './visibility.ts'

export const serializeSharedExercise = (
  record: SharedExerciseRecord,
  webHost: string,
  username: string,
): SharedExercise => ({
  activity_type: record.activity_type,
  created_at: record.created_at.toISOString(),
  field: record.field,
  id: record.id,
  name: record.name,
  share_url: buildShareUrl(webHost, username, record.slug),
  slug: record.slug,
  updated_at: record.updated_at.toISOString(),
  value: record.value,
  visibility: isPublicToVisibility(record.is_public),
})

export interface ItemPathRejection {
  error: string
  status: 400 | 404
}

/** Why `field` cannot be shared for `activityType`, or undefined when it is a categorical list-item path. */
export const assertItemPath = async (
  user: string,
  activityType: string,
  field: string,
): Promise<ItemPathRejection | undefined> => {
  const definition = await getActivityTypeDefinition(user, activityType)
  if (!definition) return { error: 'Activity type not found', status: 404 }
  if (categoricalItemPath(definition.data_schema, field)) return undefined
  return {
    error: `"${field}" is not a categorical item field of a list field of "${activityType}"`,
    status: 400,
  }
}
