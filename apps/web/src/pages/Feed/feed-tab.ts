export type FeedTab = 'following' | 'mine'

export const feedTabFromQuery = (query: Record<string, string | undefined>): FeedTab =>
  query.tab === 'mine' ? 'mine' : 'following'

/** The Feed page URL showing `tab`, keeping every other query param (e.g. `embed=1`). */
export const feedTabUrl = (path: string, query: Record<string, string | undefined>, tab: FeedTab): string => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (key !== 'tab' && value !== undefined) params.set(key, value)
  }
  if (tab === 'mine') params.set('tab', 'mine')
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}
