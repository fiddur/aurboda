import type { ExerciseCatalogSearchResult } from '@aurboda/api-spec'

type CatalogPage<T> = Pick<ExerciseCatalogSearchResult, 'total'> & { entries: T[] }

/** The entries of the loaded pages, and how many of the latest total are not loaded yet. */
export const loadedCatalog = <T>(
  pages: CatalogPage<T>[],
): { entries: T[]; remaining: number; total: number } => {
  const entries = pages.flatMap((page) => page.entries)
  const total = pages.at(-1)?.total ?? 0
  return { entries, remaining: Math.max(0, total - entries.length), total }
}

/** The offset of the next page, undefined when every entry is loaded. */
export const nextCatalogOffset = <T>(pages: CatalogPage<T>[]): number | undefined => {
  const { entries, remaining } = loadedCatalog(pages)
  return remaining > 0 ? entries.length : undefined
}
