import type { ProgrammaticTag } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'preact/hooks'
import { fetchProgrammaticTags, fetchUniqueTags } from '../state/api'

import './TagPicker.css'

interface TagEntry {
  raw: string
  display: string
}

const buildTagEntries = (uniqueTags: string[], programmaticTags: ProgrammaticTag[]): TagEntry[] => {
  const mappings = new Map<string, string>()
  for (const pt of programmaticTags) {
    if (pt.current_name) {
      mappings.set(pt.tag_key, pt.current_name)
    }
  }

  return uniqueTags.map((raw) => ({
    display: mappings.get(raw) ?? raw,
    raw,
  }))
}

export function TagPicker({
  onChange,
  selectedTags,
}: {
  selectedTags: string[]
  onChange: (tags: string[]) => void
}) {
  const [inputValue, setInputValue] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: uniqueTags } = useQuery({
    queryFn: fetchUniqueTags,
    queryKey: ['uniqueTags'],
    staleTime: 5 * 60 * 1000,
  })

  const { data: programmaticTags } = useQuery({
    queryFn: fetchProgrammaticTags,
    queryKey: ['programmaticTags'],
    staleTime: 5 * 60 * 1000,
  })

  const tagEntries = uniqueTags && programmaticTags ? buildTagEntries(uniqueTags, programmaticTags) : []

  const filteredEntries = tagEntries.filter(
    (entry) =>
      !selectedTags.includes(entry.raw) &&
      (entry.display.toLowerCase().includes(inputValue.toLowerCase()) ||
        entry.raw.toLowerCase().includes(inputValue.toLowerCase())),
  )

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightedIndex(0)
  }, [inputValue])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectTag = (raw: string) => {
    onChange([...selectedTags, raw])
    setInputValue('')
    setIsOpen(false)
    inputRef.current?.focus()
  }

  const removeTag = (raw: string) => {
    onChange(selectedTags.filter((t) => t !== raw))
  }

  const getDisplayName = (raw: string): string => tagEntries.find((e) => e.raw === raw)?.display ?? raw

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIsOpen(true)
      setHighlightedIndex((i) => Math.min(i + 1, filteredEntries.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((i) => Math.max(i - 1, 0))
    } else if ((e.key === 'Enter' || e.key === 'Tab') && isOpen && filteredEntries.length > 0) {
      e.preventDefault()
      selectTag(filteredEntries[highlightedIndex].raw)
    } else if (e.key === 'Backspace' && inputValue === '' && selectedTags.length > 0) {
      removeTag(selectedTags[selectedTags.length - 1])
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  return (
    <div class="tag-picker" ref={containerRef}>
      <div class="tag-picker-input-area" onClick={() => inputRef.current?.focus()}>
        {selectedTags.map((raw) => (
          <span class="tag-badge" key={raw}>
            {getDisplayName(raw)}
            <button type="button" class="tag-badge-remove" onClick={() => removeTag(raw)}>
              &times;
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          class="tag-picker-input"
          value={inputValue}
          onInput={(e) => {
            setInputValue((e.target as HTMLInputElement).value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={selectedTags.length === 0 ? 'Search tags...' : ''}
        />
      </div>
      {isOpen && filteredEntries.length > 0 && (
        <ul class="tag-picker-dropdown">
          {filteredEntries.map((entry, i) => (
            <li
              key={entry.raw}
              class={`tag-picker-option ${i === highlightedIndex ? 'highlighted' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                selectTag(entry.raw)
              }}
              onMouseEnter={() => setHighlightedIndex(i)}
            >
              <span class="tag-option-display">{entry.display}</span>
              {entry.display !== entry.raw && <span class="tag-option-raw">{entry.raw}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
