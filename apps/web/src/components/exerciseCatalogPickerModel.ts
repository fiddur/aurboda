export const MIN_QUERY_LENGTH = 2

export const catalogSearch = (q: string, similarTo: string | undefined) => {
  const similar = similarTo === undefined ? {} : { similar_to: similarTo }
  if (q.length >= MIN_QUERY_LENGTH) return { q, ...similar }
  return similarTo === undefined ? undefined : similar
}

export const showsClosestCaption = (
  searchedQuery: string,
  similarTo: string | undefined,
  shownCount: number,
): boolean => similarTo !== undefined && searchedQuery.length < MIN_QUERY_LENGTH && shownCount > 0
