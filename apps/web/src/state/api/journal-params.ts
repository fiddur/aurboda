import type { Note, NoteConflictResponse, NoteRelatedEntityType } from '@aurboda/api-spec'

import axios from 'axios'

/** The journal reads entries through search, newest first, paged with `next_cursor`. */
export interface JournalQuery {
  q?: string
  tags?: readonly string[]
  to?: string
  on_this_day?: string
  needs_text?: boolean
  include_comments?: boolean
  related?: { type: NoteRelatedEntityType; id: string }
  cursor?: string
  limit?: number
  tz?: string
}

/** The comment roots the "Also show comments" switch adds to the journal's own `time` and `day` entries. */
export const JOURNAL_COMMENT_TYPES = ['activity', 'meal', 'report'] as const

export const journalSearchParams = (query: JournalQuery): Record<string, string> => {
  const params: Record<string, string> = {}
  const q = query.q?.trim()
  if (q) params.q = q
  if (query.tags && query.tags.length > 0) params.tags = query.tags.join(',')
  if (query.to) params.to = query.to
  if (query.on_this_day) params.on_this_day = query.on_this_day
  if (query.needs_text) params.needs_text = 'true'
  if (query.include_comments) params.entity_types = ['time', 'day', ...JOURNAL_COMMENT_TYPES].join(',')
  if (query.related) {
    params.related_type = query.related.type
    params.related_id = query.related.id
  }
  if (query.cursor) params.cursor = query.cursor
  if (query.limit) params.limit = String(query.limit)
  if (query.tz) params.tz = query.tz
  return params
}

/** A save either lands or finds the entry changed elsewhere since `expected_updated_at`. */
export type EntrySaveResult = { kind: 'saved'; note: Note } | { kind: 'conflict'; note: Note }

/** A 409 carries the entry as it now is; anything else is a real failure. */
export const conflictFromError = (error: unknown): Note | undefined => {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) return undefined
  return (error.response.data as NoteConflictResponse | undefined)?.data
}
