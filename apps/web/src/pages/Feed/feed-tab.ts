import { normalizeTag } from '@aurboda/api-spec'

export type FeedTab = 'following' | 'mine' | 'manage'

export const feedTabFromQuery = (query: Record<string, string | undefined>): FeedTab =>
  query.tab === 'mine' || query.tab === 'manage' ? query.tab : 'following'

/** The Feed page URL showing `tab`, keeping every other query param (e.g. `embed=1`). */
export const feedTabUrl = (path: string, query: Record<string, string | undefined>, tab: FeedTab): string => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (key !== 'tab' && value !== undefined) params.set(key, value)
  }
  if (tab !== 'following') params.set('tab', tab)
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/** The hashtag the home timeline is filtered to (`?tag=`), normalised; null for all posts. */
export const feedTagFromQuery = (query: Record<string, string | undefined>): string | null =>
  query.tag ? normalizeTag(query.tag) : null

/** The Feed page URL filtering the timeline to `tag` (null: all posts), keeping every other query param. */
export const feedTagUrl = (
  path: string,
  query: Record<string, string | undefined>,
  tag: string | null,
): string => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (key !== 'tag' && value !== undefined) params.set(key, value)
  }
  if (tag != null) params.set('tag', tag)
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}
