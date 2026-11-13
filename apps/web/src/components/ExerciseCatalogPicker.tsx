import type { ExerciseCatalogEntry } from '@aurboda/api-spec'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'preact/hooks'

import { searchExerciseCatalog } from '../state/api'
import './ExerciseCatalogPicker.css'
import { catalogHint, stepActiveIndex } from './knownValueSuggestions'
import { useDebounced } from './useDebounced'

const STALE_TIME = 5 * 60 * 1000
const CATALOG_DEBOUNCE_MS = 200
const MIN_QUERY_LENGTH = 2

/** A search field over the exercise catalogue with its results listed under it, for choosing one entry. */
export const ExerciseCatalogPicker = ({
  onPick,
  initialQuery = '',
  autoFocus = false,
  id,
  disabled = false,
}: {
  onPick: (entry: ExerciseCatalogEntry) => void
  initialQuery?: string
  autoFocus?: boolean
  id?: string
  disabled?: boolean
}) => {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(initialQuery)
  const [activeIndex, setActiveIndex] = useState(0)

  const typed = text.trim()
  const q = useDebounced(typed, CATALOG_DEBOUNCE_MS)
  const { data, isFetching, isPlaceholderData } = useQuery({
    enabled: q.length >= MIN_QUERY_LENGTH,
    placeholderData: keepPreviousData,
    queryFn: () => searchExerciseCatalog({ limit: 8, q }),
    queryKey: ['exercise-catalog', 'search', q],
    staleTime: STALE_TIME,
  })
  const searching = typed.length >= MIN_QUERY_LENGTH
  const entries = searching ? (data?.entries ?? []) : []
  const settled = searching && q === typed && !isFetching && !isPlaceholderData && data !== undefined
  const noMatch = settled && entries.length === 0

  useEffect(() => {
    setActiveIndex(0)
  }, [data])

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
      {noMatch && <p class="exercise-catalog-picker-empty">No match in the catalogue</p>}
    </div>
  )
}
