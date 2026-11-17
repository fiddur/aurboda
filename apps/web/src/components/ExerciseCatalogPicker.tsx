import type { ExerciseCatalogEntry } from '@aurboda/api-spec'

import { useEffect, useId, useRef, useState } from 'preact/hooks'

import './ExerciseCatalogPicker.css'
import { catalogHint, stepActiveIndex } from './knownValueSuggestions'
import { useDebounced } from './useDebounced'
import { useExerciseCatalogPages } from './useExerciseCatalogPages'

const STALE_TIME = 5 * 60 * 1000
const CATALOG_DEBOUNCE_MS = 200
const MIN_QUERY_LENGTH = 2
const PAGE_SIZE = 10

const catalogSearch = (q: string, similarTo: string | undefined) => {
  const similar = similarTo === undefined ? {} : { similar_to: similarTo }
  if (q.length >= MIN_QUERY_LENGTH) return { q, ...similar }
  return similarTo === undefined ? undefined : similar
}

const ShowMore = ({
  shown,
  total,
  disabled,
  onClick,
}: {
  shown: number
  total: number
  disabled: boolean
  onClick: () => void
}) => (
  <div class="exercise-catalog-picker-more">
    <span class="exercise-catalog-picker-count">
      {shown} of {total}
    </span>
    <button type="button" class="btn-secondary" disabled={disabled} onClick={onClick}>
      Show more
    </button>
  </div>
)

const useCatalogResults = (text: string, similarTo: string | undefined) => {
  const similar = similarTo?.trim() || undefined
  const typed = text.trim()
  const q = useDebounced(typed, CATALOG_DEBOUNCE_MS)
  const query = catalogSearch(q, similar)
  const pages = useExerciseCatalogPages({
    enabled: query !== undefined,
    pageSize: PAGE_SIZE,
    query: query ?? {},
    staleTime: STALE_TIME,
  })
  const searching = typed.length >= MIN_QUERY_LENGTH
  const closestOnly = !searching && similar !== undefined
  const entries = searching || closestOnly ? pages.entries : []
  const settled = searching && q === typed && !pages.isFetching && !pages.isPlaceholderData && pages.isLoaded
  return {
    caption: closestOnly && entries.length > 0,
    entries,
    noMatch: settled && entries.length === 0,
    pages,
    queryId: `${q}\n${similar ?? ''}`,
    remaining: entries.length > 0 ? pages.remaining : 0,
  }
}

/**
 * A search field over the exercise catalogue with its results listed under it, for choosing one entry.
 * With `similarTo` (a logged exercise name) it opens on the entries closest to that name and keeps
 * them near the top while the user types.
 */
export const ExerciseCatalogPicker = ({
  onPick,
  similarTo,
  autoFocus = false,
  id,
  disabled = false,
}: {
  onPick: (entry: ExerciseCatalogEntry) => void
  similarTo?: string
  autoFocus?: boolean
  id?: string
  disabled?: boolean
}) => {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const { caption, entries, noMatch, pages, queryId, remaining } = useCatalogResults(text, similarTo)

  useEffect(() => {
    setActiveIndex(0)
  }, [queryId])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((current) => stepActiveIndex(current, e.key === 'ArrowDown' ? 1 : -1, entries.length))
    } else if (e.key === 'Enter' && !e.isComposing && entries[activeIndex]) {
      e.preventDefault()
      onPick(entries[activeIndex])
    } else if (e.key === 'Escape' && text !== '') {
      e.preventDefault()
      e.stopPropagation()
      setText('')
    }
  }

  const expanded = entries.length > 0

  return (
    <div class="exercise-catalog-picker">
      <input
        id={id}
        ref={inputRef}
        type="text"
        class="exercise-catalog-picker-input"
        placeholder="Search the catalogue"
        aria-label="Search the exercise catalogue"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded ? `${listId}-${activeIndex}` : undefined}
        value={text}
        disabled={disabled}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onKeyDown={onKeyDown}
      />
      {caption && <p class="exercise-catalog-picker-caption">Closest matches</p>}
      <div id={listId} role="listbox" aria-label="Catalogue exercises" class="exercise-catalog-picker-list">
        {entries.map((entry, i) => {
          const hint = catalogHint(entry)
          return (
            <button
              key={entry.key}
              id={`${listId}-${i}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={i === activeIndex}
              class={`exercise-catalog-picker-option${i === activeIndex ? ' active' : ''}`}
              disabled={disabled}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => onPick(entry)}
            >
              <span class="exercise-catalog-picker-name">{entry.name}</span>
              {hint !== undefined && <span class="exercise-catalog-picker-hint">{hint}</span>}
            </button>
          )
        })}
      </div>
      {remaining > 0 && (
        <ShowMore
          shown={entries.length}
          total={pages.total}
          disabled={disabled || pages.isLoadingMore}
          onClick={pages.loadMore}
        />
      )}
      {noMatch && <p class="exercise-catalog-picker-empty">No match in the catalogue</p>}
    </div>
  )
}
