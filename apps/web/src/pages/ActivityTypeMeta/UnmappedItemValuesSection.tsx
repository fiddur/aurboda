import type { UnmappedItemValue, UnmappedItemValues } from '@aurboda/api-spec'

import { type InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useState } from 'preact/hooks'

import { ExerciseCatalogPicker } from '../../components/ExerciseCatalogPicker'
import { catalogHint } from '../../components/knownValueSuggestions'
import { itemPageHref } from '../../components/sessions/sessionView'
import {
  apiErrorMessage,
  fetchUnmappedItemValues,
  ITEM_VALUE_IDENTITY_INVALIDATED_KEYS,
  setItemValueIdentityApi,
} from '../../state/api'
import { loadedUnmapped, nextUnmappedOffset, UNMAPPED_PAGE_SIZE, unmappedSummary } from './unmappedItemValues'

const UnmappedRow = ({ name, path, item }: { name: string; path: string; item: UnmappedItemValue }) => {
  const queryClient = useQueryClient()
  const [searching, setSearching] = useState(false)
  const map = useMutation({
    mutationFn: (key: string | null) =>
      setItemValueIdentityApi(name, { field: path, key, value: item.value }),
    onSuccess: async () => {
      await Promise.all(
        ITEM_VALUE_IDENTITY_INVALIDATED_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      )
    },
  })
  const pending = map.isPending

  return (
    <li class="activity-type-meta-unmapped-row">
      <div class="activity-type-meta-unmapped-value">
        <a href={itemPageHref(name, path, item.value)}>{item.value}</a>
        <span class="session-muted">
          {item.count}× · last {format(new Date(item.last_used), 'yyyy-MM-dd')}
        </span>
      </div>
      <div class="activity-type-meta-unmapped-actions">
        {item.suggestions.map((entry) => (
          <button
            key={entry.key}
            type="button"
            class="btn-secondary activity-type-meta-unmapped-action"
            title={catalogHint(entry)}
            disabled={pending}
            onClick={() => map.mutate(entry.key)}
          >
            {entry.name}
          </button>
        ))}
        <button
          type="button"
          class="btn-secondary activity-type-meta-unmapped-action"
          aria-expanded={searching}
          disabled={pending}
          onClick={() => setSearching((open) => !open)}
        >
          Search…
        </button>
        <button
          type="button"
          class="btn-secondary activity-type-meta-unmapped-action"
          disabled={pending}
          onClick={() => map.mutate(null)}
        >
          Not in the catalogue
        </button>
      </div>
      {searching && (
        <div class="activity-type-meta-unmapped-picker">
          <ExerciseCatalogPicker
            similarTo={item.value}
            autoFocus
            disabled={pending}
            onPick={(entry) => map.mutate(entry.key)}
          />
        </div>
      )}
      {map.error && <p class="error">{apiErrorMessage(map.error, 'Saving failed. Please try again.')}</p>}
    </li>
  )
}

export const unmappedSectionId = (path: string): string => `unmapped-${path}`

type UnmappedPage = Pick<UnmappedItemValues, 'total' | 'values'>

/** The logged names of a catalogue-backed item field that match no catalogue entry, to map or dismiss. */
export function UnmappedItemValuesSection({ name, path }: { name: string; path: string }) {
  const [expanded, setExpanded] = useState(false)
  const query = useInfiniteQuery<UnmappedPage, Error, InfiniteData<UnmappedPage>, string[], number>({
    getNextPageParam: (_last, pages) => nextUnmappedOffset(pages),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      (await fetchUnmappedItemValues(name, path, { limit: UNMAPPED_PAGE_SIZE, offset: pageParam })) ?? {
        total: 0,
        values: [],
      },
    queryKey: ['unmapped-item-values', name, path],
    staleTime: 5 * 60 * 1000,
  })
  const { rows, remaining, total } = loadedUnmapped(query.data?.pages ?? [])
  if (rows.length === 0) return null

  return (
    <section id={unmappedSectionId(path)} class="activity-type-meta-section activity-type-meta-unmapped">
      <h2>Not in the catalogue</h2>
      <p class="activity-type-meta-unmapped-summary">{unmappedSummary(total)}</p>
      {!expanded ? (
        <button type="button" class="btn-secondary" onClick={() => setExpanded(true)}>
          Review
        </button>
      ) : (
        <>
          <p class="session-muted activity-type-meta-unmapped-note">
            Matching a name to the catalogue adds its muscles and equipment. Names you leave here keep working
            as they are.
          </p>
          <ul class="activity-type-meta-unmapped-list">
            {rows.map((item) => (
              <UnmappedRow key={item.value} name={name} path={path} item={item} />
            ))}
          </ul>
          {remaining > 0 && (
            <button
              type="button"
              class="btn-secondary activity-type-meta-unmapped-more"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Show more ({remaining})
            </button>
          )}
        </>
      )}
    </section>
  )
}
