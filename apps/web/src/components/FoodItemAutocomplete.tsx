import { useEffect, useRef, useState } from 'preact/hooks'

import { type FoodItemEntity, searchFoodItemsApi } from '../state/api'
import './FoodItemAutocomplete.css'

interface FoodItemAutocompleteProps {
  value: string
  onChange: (name: string) => void
  onSelect: (item: FoodItemEntity) => void
  placeholder?: string
  class?: string
}

export function FoodItemAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  ...rest
}: FoodItemAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<FoodItemEntity[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Debounced search
  useEffect(() => {
    if (value.length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const results = await searchFoodItemsApi(value, 8)
      setSuggestions(results)
      setOpen(results.length > 0)
      setActiveIndex(-1)
    }, 300)

    return () => clearTimeout(debounceRef.current)
  }, [value])

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

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!open || suggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      handleSelect(suggestions[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={ref} class={`food-autocomplete ${rest.class ?? ''}`}>
      <input
        type="text"
        value={value}
        placeholder={placeholder ?? 'Food name'}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true)
        }}
      />
      {open && (
        <ul class="autocomplete-dropdown">
          {suggestions.map((item, i) => (
            <li
              key={item.id}
              class={`autocomplete-option ${i === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => handleSelect(item)}
            >
              <span class="ac-name">{item.name}</span>
              {item.calories !== undefined && <span class="ac-cal">{item.calories} kcal</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
