import type { ExerciseCatalogQuery, ExerciseCatalogSearchResult } from '@aurboda/api-spec'

import { type InfiniteData, keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'

import { searchExerciseCatalog } from '../state/api'
import { loadedCatalog, nextCatalogOffset } from './exerciseCatalogPages'

type CatalogQuery = Omit<Partial<ExerciseCatalogQuery>, 'limit' | 'offset'>

/** A catalogue search loaded a page at a time; `loadMore` fetches the next page. */
export const useExerciseCatalogPages = ({
  query,
  pageSize,
  enabled,
  staleTime,
}: {
  query: CatalogQuery
  pageSize: number
  enabled: boolean
  staleTime: number
}) => {
  const result = useInfiniteQuery<
    ExerciseCatalogSearchResult,
    Error,
    InfiniteData<ExerciseCatalogSearchResult>,
    unknown[],
    number
  >({
    enabled,
    getNextPageParam: (_last, pages) => nextCatalogOffset(pages),
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => searchExerciseCatalog({ ...query, limit: pageSize, offset: pageParam }),
    queryKey: ['exercise-catalog', 'pages', query, pageSize],
    staleTime,
  })
  const { entries, remaining, total } = loadedCatalog(result.data?.pages ?? [])
  return {
    entries,
    isFetching: result.isFetching,
    isLoaded: result.data !== undefined,
    isLoadingMore: result.isFetchingNextPage,
    isPlaceholderData: result.isPlaceholderData,
    loadMore: () => {
      if (result.hasNextPage && !result.isFetchingNextPage) void result.fetchNextPage()
    },
    remaining,
    total,
  }
}
