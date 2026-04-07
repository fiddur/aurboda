import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'preact/hooks'

import { fetchActivityTypeDefinitions } from '../state/api'
import { toDisplayName } from '../utils/displayName'
import './MetricPicker.css'

interface ActivityTypePickerProps {
  value: string
  onChange: (activityType: string) => void
  placeholder?: string
}

/** Convert a display name to snake_case identifier. */
const toSnakeCase = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_|_$/g, '')
    .replaceAll(/_+/g, '_') || ''

export function ActivityTypePicker({
  value,
  onChange,
  placeholder = 'Search or type new...',
}: ActivityTypePickerProps) {
  const [inputValue, setInputValue] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const { data: typeDefs } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activity-type-definitions'],
    staleTime: 30 * 60 * 1000,
  })

  const allDefs = typeDefs ?? []
  const query = inputValue.toLowerCase()

  const filtered = query
    ? allDefs.filter((d) => d.display_name.toLowerCase().includes(query) || d.name.includes(query))
    : allDefs

  // If the user typed something that doesn't match any existing type, offer to create it
  const snakeInput = toSnakeCase(inputValue)
  const isNewType = query.length > 0 && snakeInput.length > 0 && !allDefs.some((d) => d.name === snakeInput)

  const flatList = filtered
  const totalItems = flatList.length + (isNewType ? 1 : 0)

  useEffect(() => {
    setHighlightedIndex(0)
  }, [inputValue])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setInputValue('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const select = (typeName: string) => {
    onChange(typeName)
    setInputValue('')
    setIsOpen(false)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIsOpen(true)
      setHighlightedIndex((i) => Math.min(i + 1, totalItems - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && isOpen && totalItems > 0) {
      e.preventDefault()
      if (highlightedIndex < flatList.length) {
        select(flatList[highlightedIndex].name)
      } else if (isNewType) {
        select(snakeInput)
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
      setInputValue('')
    }
  }

  const displayValue = value
    ? (allDefs.find((d) => d.name === value)?.display_name ?? toDisplayName(value))
    : ''
  const shownValue = isOpen ? inputValue : displayValue

  return (
    <div class="metric-picker" ref={containerRef}>
      <input
        type="text"
        class="metric-picker-input"
        value={shownValue}
        onInput={(e) => {
          setInputValue((e.target as HTMLInputElement).value)
          setIsOpen(true)
        }}
        onFocus={() => {
          setInputValue('')
          setIsOpen(true)
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
      {isOpen && totalItems > 0 && (
        <ul class="metric-picker-dropdown">
          {flatList.map((def, idx) => (
            <li
              key={def.name}
              class={`metric-picker-option ${idx === highlightedIndex ? 'highlighted' : ''} ${def.name === value ? 'selected' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                select(def.name)
              }}
              onMouseEnter={() => setHighlightedIndex(idx)}
            >
              <span class="metric-option-label">
                {def.icon ? `${def.icon} ` : ''}
                {def.display_name || toDisplayName(def.name)}
              </span>
              {def.display_category !== 'other' && (
                <span class="metric-option-key">{def.display_category}</span>
              )}
            </li>
          ))}
          {isNewType && (
            <li
              class={`metric-picker-option ${highlightedIndex === flatList.length ? 'highlighted' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                select(snakeInput)
              }}
              onMouseEnter={() => setHighlightedIndex(flatList.length)}
            >
              <span class="metric-option-label">Create "{toDisplayName(snakeInput)}"</span>
              <span class="metric-option-key">{snakeInput}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
