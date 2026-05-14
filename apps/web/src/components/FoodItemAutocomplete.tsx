import { useEffect, useRef, useState } from 'preact/hooks'

import { type FoodItemEntity, searchFoodItemsApi } from '../state/api'
import './FoodItemAutocomplete.css'

interface FoodItemAutocompleteProps {
  value: string
  onChange: (name: string) => void
  onSelect: (item: FoodItemEntity) => void
  /**
   * Optional explicit-create hook. When provided, a "+ Create '<value>'" row
   * is appended to the dropdown so the user can opt into creating a new
   * canonical food item from the typed name. Without this, the autocomplete
   * is search-only — preventing the backend's findOrCreate path from being
   * triggered implicitly by autosave keystrokes.
   */
  onCreate?: (name: string) => Promise<FoodItemEntity>
  placeholder?: string
  class?: string
  autoFocus?: boolean
}

export function FoodItemAutocomplete({
  value,
  onChange,
  onSelect,
  onCreate,
  placeholder,
  autoFocus,
  ...rest
}: FoodItemAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<FoodItemEntity[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [creating, setCreating] = useState(false)
  // Whether the input is currently focused. Without this gate, every
  // FoodItemAutocomplete on a freshly-loaded meal would auto-fire a search
  // for its pre-filled value and pop its dropdown — N food items in a meal
  // = N dropdowns opening simultaneously on page load.
  const [hasFocus, setHasFocus] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const trimmed = value.trim()
  const canCreate = !!onCreate && trimmed.length >= 2
  const exactMatch = suggestions.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())
  const showCreate = canCreate && !exactMatch
  const createIndex = showCreate ? suggestions.length : -1

  // Debounced search — only when the input is focused. Re-runs when
  // hasFocus flips true so re-focusing a populated field also re-fetches.
  useEffect(() => {
    if (value.length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    if (!hasFocus) return

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const results = await searchFoodItemsApi(value, 8)
      setSuggestions(results)
      // Open the dropdown whenever there's either a suggestion or a
      // "+ Create" row to show. With explicit-create enabled, zero matches
      // still means there's a row to pick.
      setOpen(results.length > 0 || !!onCreate)
      setActiveIndex(-1)
    }, 300)

    return () => clearTimeout(debounceRef.current)
  }, [value, hasFocus, onCreate])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [open])

  const handleSelect = (item: FoodItemEntity) => {
    onChange(item.name)
    onSelect(item)
    setOpen(false)
  }

  const handleCreate = async () => {
    if (!onCreate || creating) return
    setCreating(true)
    try {
      const created = await onCreate(trimmed)
      handleSelect(created)
    } finally {
      setCreating(false)
    }
  }

  const optionCount = suggestions.length + (showCreate ? 1 : 0)

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!open || optionCount === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, optionCount - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      if (activeIndex === createIndex) {
        void handleCreate()
      } else {
        handleSelect(suggestions[activeIndex])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={ref} class={`food-autocomplete ${rest.class ?? ''}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder ?? 'Food name'}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          setHasFocus(true)
          // Re-show pre-cached suggestions immediately. The effect will
          // re-fire to refresh them in the background.
          if (suggestions.length > 0 || (canCreate && !exactMatch)) setOpen(true)
        }}
        onBlur={() => {
          // Don't close on blur — clicking a suggestion blurs the input
          // before its onClick fires, and the existing click-outside
          // handler already closes the dropdown when the user actually
          // clicks away. Just stop firing fresh searches.
          setHasFocus(false)
        }}
      />
      {open && optionCount > 0 && (
        <ul class="autocomplete-dropdown">
          {suggestions.map((item, i) => (
            <li
              key={item.id}
              class={`autocomplete-option ${i === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => handleSelect(item)}
            >
              <span class="ac-name">{item.name}</span>
              <span class="ac-cal">
                {item.calories !== undefined ? `${item.calories} kcal` : '(no data)'}
              </span>
            </li>
          ))}
          {showCreate && (
            <li
              key="__create"
              class={`autocomplete-option autocomplete-create ${createIndex === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(createIndex)}
              onClick={() => void handleCreate()}
            >
              <span class="ac-name">{creating ? 'Creating…' : <>+ Create &ldquo;{trimmed}&rdquo;</>}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
