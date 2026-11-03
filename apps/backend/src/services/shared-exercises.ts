import type { SharedExercise } from '@aurboda/api-spec'

import type { SharedExerciseRecord } from '../db/index.ts'

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
