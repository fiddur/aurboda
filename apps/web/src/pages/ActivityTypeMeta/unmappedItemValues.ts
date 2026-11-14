export const UNMAPPED_PAGE_SIZE = 20

export const unmappedSummary = (count: number): string =>
  `${count} ${count === 1 ? 'exercise name is' : 'exercise names are'} not matched to the built-in catalogue.`

interface UnmappedPage<T> {
  total: number
  values: T[]
}

/** The rows of the fetched pages, and how many of the latest total are not fetched yet. */
export const loadedUnmapped = <T>(
  pages: UnmappedPage<T>[],
): { rows: T[]; remaining: number; total: number } => {
  const rows = pages.flatMap((page) => page.values)
  const total = pages.at(-1)?.total ?? 0
  return { remaining: Math.max(0, total - rows.length), rows, total }
}

/** The offset of the next page, undefined when every name is fetched. */
export const nextUnmappedOffset = <T>(pages: UnmappedPage<T>[]): number | undefined => {
  const { remaining, rows } = loadedUnmapped(pages)
  return remaining > 0 ? rows.length : undefined
}
