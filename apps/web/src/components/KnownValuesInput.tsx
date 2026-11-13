import type { DataFieldCatalog } from '@aurboda/api-spec'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'

import { fetchActivityFieldValues, searchExerciseCatalog } from '../state/api'
import {
  exactMatchIndex,
  filterKnownValues,
  mergeSuggestions,
  stepActiveIndex,
} from './knownValueSuggestions'
import './KnownValuesInput.css'
import { useDebounced } from './useDebounced'

const STALE_TIME = 5 * 60 * 1000
const CATALOG_DEBOUNCE_MS = 200
const VIEWPORT_MARGIN = 8

const floatingStyle = (input: HTMLInputElement): Record<string, string> => {
  const rect = input.getBoundingClientRect()
  const top = rect.bottom + 2
  const left = Math.max(VIEWPORT_MARGIN, rect.left)
  return {
    left: `${left}px`,
    maxHeight: `${Math.max(0, Math.min(240, window.innerHeight - top - VIEWPORT_MARGIN))}px`,
    maxWidth: `${Math.max(rect.width, Math.min(448, window.innerWidth - left - VIEWPORT_MARGIN))}px`,
    minWidth: `${rect.width}px`,
    top: `${top}px`,
  }
}

export const KnownValuesInput = ({
  id,
  activityType,
  field,
  value,
  onChange,
  class: className,
  placeholder,
  'aria-label': ariaLabel,
  focus,
  catalog,
  floating = false,
}: {
  id?: string
  activityType: string
  field: string
  value: string
  onChange: (value: string) => void
  class?: string
  placeholder?: string
  'aria-label'?: string
  focus?: boolean
  catalog?: DataFieldCatalog
  floating?: boolean
}) => {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [position, setPosition] = useState<Record<string, string> | undefined>(undefined)

  const { data } = useQuery({
    queryFn: () => fetchActivityFieldValues(activityType, field),
    queryKey: ['activity-field-values', activityType, field],
    staleTime: STALE_TIME,
  })

  const catalogQuery = useDebounced(value.trim(), CATALOG_DEBOUNCE_MS)
  const { data: catalogData } = useQuery({
    enabled: catalog === 'exercises' && catalogQuery.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: () => searchExerciseCatalog({ limit: 8, q: catalogQuery }),
    queryKey: ['exercise-catalog', 'search', catalogQuery],
    staleTime: STALE_TIME,
  })
  const catalogEntries =
    catalog === 'exercises' && value.trim().length >= 2 ? catalogData?.entries : undefined

  const suggestions = useMemo(
    () => mergeSuggestions(filterKnownValues(data?.values ?? [], value), catalogEntries ?? []),
    [data, value, catalogEntries],
  )
  const expanded = open && suggestions.length > 0

  useLayoutEffect(() => {
    if (!floating || !expanded) return
    const place = () => {
      if (inputRef.current) setPosition(floatingStyle(inputRef.current))
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [floating, expanded, value])

  useEffect(() => {
    setActiveIndex(exactMatchIndex(suggestions, value))
  }, [suggestions])

  useEffect(() => {
    if (focus) inputRef.current?.focus()
  }, [focus])

  const pick = (picked: string) => {
    onChange(picked)
    setOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!expanded) {
        setOpen(true)
        return
      }
      setActiveIndex((current) =>
        stepActiveIndex(current, e.key === 'ArrowDown' ? 1 : -1, suggestions.length),
      )
    } else if (e.key === 'Enter' && !e.isComposing && expanded && activeIndex >= 0) {
      e.preventDefault()
      pick(suggestions[activeIndex].value)
    } else if (e.key === 'Escape' && expanded) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <span class="known-values">
      <input
        id={id}
        ref={inputRef}
        type="text"
        class={className}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        value={value}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onInput={(e) => {
          onChange((e.target as HTMLInputElement).value)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          class={`known-values-list${floating ? ' known-values-list-floating' : ''}`}
          style={floating ? position : undefined}
          onMouseDown={(e) => e.preventDefault()}
        >
          {suggestions.map((v, i) => (
            <li
              key={v.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              class={`known-values-option${i === activeIndex ? ' active' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => pick(v.value)}
            >
              <span class="known-values-value">{v.value}</span>
              {v.count !== undefined ? (
                <span class="known-values-count">{v.count}×</span>
              ) : (
                v.hint !== undefined && <span class="known-values-hint">{v.hint}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
