import type { FeedVisibility, ShareExerciseBody } from '@aurboda/api-spec'

export interface ExerciseShareForm {
  activityType: string
  field: string
  value: string
  message: string
  visibility: FeedVisibility
  includeRecords: boolean
  includeChart: boolean
  includeSessions: boolean
  includeLink: boolean
  /** Whether the exercise is published, the only case where a link can be included. */
  published: boolean
  /** Explicit tags; left out, the post gets the automatic ones. */
  tags?: string[]
}

export const buildExerciseShareBody = (form: ExerciseShareForm): ShareExerciseBody => {
  const message = form.message.trim()
  return {
    activity_type: form.activityType,
    field: form.field,
    include_chart: form.includeChart,
    include_link: form.includeLink && form.published,
    include_records: form.includeRecords,
    include_sessions: form.includeSessions,
    ...(message === '' ? {} : { message }),
    ...(form.tags === undefined ? {} : { tags: form.tags }),
    value: form.value,
    visibility: form.visibility,
  }
}

/** The preview's cache key: the body without `visibility`, which does not change what is posted. */
export const exerciseSharePreviewKey = ({ visibility: _visibility, ...rest }: ShareExerciseBody): string =>
  JSON.stringify(rest)
