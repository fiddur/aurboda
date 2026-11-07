/**
 * The tags input of the share dialogs, the article editor, the auto-share
 * rules and the settings: a free-text field of `#tags` separated by spaces or
 * commas, stored lowercase without `#` (the same rules as the backend, from
 * `@aurboda/api-spec`).
 */
import { defaultFeedTags, normalizeTag, normalizeTags } from '@aurboda/api-spec'

const tokens = (text: string): string[] => text.split(/[\s,]+/).filter(Boolean)

export const parseTagsInput = (text: string): string[] => normalizeTags(tokens(text))

/** Like {@link parseTagsInput} without the per-post cap: a filter may list more tags than a post carries. */
export const parseTagFilterInput = (text: string): string[] => [
  ...new Set(tokens(text).flatMap((token) => normalizeTag(token) ?? [])),
]

export const formatTagsInput = (tags: readonly string[]): string => tags.map((tag) => `#${tag}`).join(' ')

/** The words of the input that are not tags (shown as a warning; they are dropped). */
export const invalidTagTokens = (text: string): string[] =>
  tokens(text).filter((token) => normalizeTag(token) == null)

export interface FeedTagSettings {
  feed_default_tags?: string[]
  feed_type_tag?: boolean
}

/** The automatic tags of a share, as the backend computes them: default tags plus the kind tag unless off. */
export const autoTagsFor = (settings: FeedTagSettings | undefined, kindTag: string | null): string[] => [
  ...(settings?.feed_default_tags ?? defaultFeedTags),
  ...(kindTag != null && settings?.feed_type_tag !== false ? [kindTag] : []),
]

/** The `?tag=` filter of a public profile, normalised; null when absent or not a tag. */
export const tagFilterFromQuery = (value: unknown): string | null =>
  typeof value === 'string' ? normalizeTag(value) : null

/** A profile's posts filtered by one tag — where a post's tag links lead. */
export const profileTagPath = (username: string, tag: string): string =>
  `/u/${encodeURIComponent(username)}?tag=${encodeURIComponent(tag)}`
