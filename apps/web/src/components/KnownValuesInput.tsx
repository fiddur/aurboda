import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks'

import { fetchActivityFieldValues } from '../state/api'
import { exactMatchIndex, filterKnownValues, stepActiveIndex } from './knownValueSuggestions'
import './KnownValuesInput.css'

export const KnownValuesInput = ({
  activityType,
  field,
  value,
  onChange,
  class: className,
  placeholder,
  'aria-label': ariaLabel,
  focus,
}: {
  activityType: string
  field: string
  value: string
  onChange: (value: string) => void
  class?: string
  placeholder?: string
  'aria-label'?: string
  focus?: boolean
}) => {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const { data } = useQuery({
    queryFn: () => fetchActivityFieldValues(activityType, field),
    queryKey: ['activity-field-values', activityType, field],
    staleTime: 5 * 60 * 1000,
  })

  const suggestions = useMemo(() => filterKnownValues(data?.values ?? [], value), [data, value])
  const expanded = open && suggestions.length > 0

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
        <ul id={listId} role="listbox" class="known-values-list" onMouseDown={(e) => e.preventDefault()}>
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
              <span class="known-values-count">{v.count}×</span>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
