import type { NoteTagSummary } from '@aurboda/api-spec'

import { normalizeTag } from '@aurboda/api-spec'
import { format } from 'date-fns'

/** A typed tag as stored (trimmed, lowercase, no leading `#`), or null when it is not a valid tag. */
export const mergeTargetTag = (input: string): string | null => normalizeTag(input)

/** The tags whose name holds the search (with or without `#`), most used first as listed, minus `exclude`. */
export const tagOptions = (
  tags: readonly NoteTagSummary[],
  search: string,
  exclude: readonly string[] = [],
): NoteTagSummary[] => {
  const needle = search.trim().replace(/^#/, '').normalize('NFC').toLowerCase()
  return tags.filter((t) => !exclude.includes(t.tag) && t.tag.includes(needle))
}

export const entriesLabel = (count: number): string => (count === 1 ? '1 entry' : `${count} entries`)

/** The day a tag was last used, here: "20 Nov 2026". */
export const lastUsedLabel = (lastUsed: string): string => {
  const at = new Date(lastUsed)
  return Number.isNaN(at.getTime()) ? '' : format(at, 'd MMM yyyy')
}

export const tagFilterHref = (tag: string): string => `/journal?tag=${encodeURIComponent(tag)}`
