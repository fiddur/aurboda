import { useEffect, useRef, useState } from 'preact/hooks'

import { type FoodItemEntity, searchFoodItemsApi } from '../state/api'
import { barcodeFromText } from '../utils/barcode'
import { canScanBarcodes } from '../utils/barcodeReader'
import { ScanBarcodeButton } from './BarcodeScanner'
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
  /**
   * When provided and the typed text is a barcode (8 to 14 digits), a
   * "Look up barcode … at Open Food Facts" row is offered; the product it
   * resolves to is selected like a search result. Rejects with a message
   * ready to show.
   */
  onLookupBarcode?: (barcode: string) => Promise<FoodItemEntity>
  placeholder?: string
  class?: string
  autoFocus?: boolean
}

export function FoodItemAutocomplete({
  value,
  onChange,
  onSelect,
  onCreate,
  onLookupBarcode,
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
  const barcodeLookup = useBarcodeLookup(trimmed, onLookupBarcode)
  const { barcode } = barcodeLookup
  const scannable = !!onLookupBarcode && canScanBarcodes()
  const canCreate = !!onCreate && trimmed.length >= 2 && !barcode
  const exactMatch = suggestions.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())
  const showCreate = canCreate && !exactMatch
  const { barcodeIndex, createIndex, optionCount } = optionLayout(suggestions.length, !!barcode, showCreate)

  // Debounced search — only when the input is focused. Re-runs when
  // hasFocus flips true so re-focusing a populated field also re-fetches.
  useEffect(() => {
    const query = value.trim()
    if (query.length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    if (!hasFocus) return

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const results = await searchFoodItemsApi(query, 8)
      setSuggestions(results)
      // Open the dropdown whenever there's either a suggestion or a
      // "+ Create" row to show. With explicit-create enabled, zero matches
      // still means there's a row to pick.
      setOpen(results.length > 0 || !!onCreate || isBarcodeQuery(query, onLookupBarcode))
      setActiveIndex(-1)
    }, 300)

    return () => clearTimeout(debounceRef.current)
  }, [value, hasFocus, onCreate, onLookupBarcode])

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

  const handleLookupBarcode = async () => {
    const item = await barcodeLookup.lookup()
    if (item) handleSelect(item)
  }

  const handleScan = async (code: string) => {
    onChange(code)
    setOpen(true)
    const item = await barcodeLookup.lookup(code)
    if (item) handleSelect(item)
  }

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
      } else if (activeIndex === barcodeIndex) {
        void handleLookupBarcode()
      } else {
        handleSelect(suggestions[activeIndex])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={ref} class={`food-autocomplete ${scannable ? 'has-scan' : ''} ${rest.class ?? ''}`}>
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
          if (suggestions.length > 0 || (canCreate && !exactMatch) || barcode) setOpen(true)
        }}
        onBlur={() => {
          // Don't close on blur — clicking a suggestion blurs the input
          // before its onClick fires, and the existing click-outside
          // handler already closes the dropdown when the user actually
          // clicks away. Just stop firing fresh searches.
          setHasFocus(false)
        }}
      />
      {scannable && (
        <ScanBarcodeButton variant="icon" class="ac-scan" onCode={(code) => void handleScan(code)} />
      )}
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
          {barcode && (
            <BarcodeOption
              barcode={barcode}
              active={barcodeIndex === activeIndex}
              lookingUp={barcodeLookup.lookingUp}
              error={barcodeLookup.error}
              onHover={() => setActiveIndex(barcodeIndex)}
              onPick={() => void handleLookupBarcode()}
            />
          )}
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

const isBarcodeQuery = (query: string, onLookupBarcode: unknown): boolean =>
  !!onLookupBarcode && barcodeFromText(query) !== null

const useBarcodeLookup = (
  trimmed: string,
  onLookupBarcode: ((barcode: string) => Promise<FoodItemEntity>) | undefined,
) => {
  const [lookingUp, setLookingUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const barcode = onLookupBarcode ? barcodeFromText(trimmed) : null

  useEffect(() => {
    setError(null)
  }, [trimmed])

  const lookup = async (code: string | null = barcode): Promise<FoodItemEntity | null> => {
    if (!onLookupBarcode || !code || lookingUp) return null
    setLookingUp(true)
    setError(null)
    try {
      return await onLookupBarcode(code)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The barcode lookup failed.')
      return null
    } finally {
      setLookingUp(false)
    }
  }

  return { barcode, error, lookingUp, lookup }
}

function BarcodeOption({
  barcode,
  active,
  lookingUp,
  error,
  onHover,
  onPick,
}: {
  barcode: string
  active: boolean
  lookingUp: boolean
  error: string | null
  onHover: () => void
  onPick: () => void
}) {
  return (
    <li
      class={`autocomplete-option autocomplete-barcode ${active ? 'active' : ''}`}
      onMouseEnter={onHover}
      onClick={onPick}
    >
      <span class="ac-name">
        {lookingUp
          ? `Looking up barcode ${barcode} at Open Food Facts…`
          : `Look up barcode ${barcode} at Open Food Facts`}
        {error && (
          <span class="ac-error" role="alert">
            {error}
          </span>
        )}
      </span>
    </li>
  )
}

/** Suggestions first, then the barcode row, then the create row; -1 for a row that is not shown. */
const optionLayout = (suggestionCount: number, hasBarcode: boolean, hasCreate: boolean) => {
  const barcodeIndex = hasBarcode ? suggestionCount : -1
  const afterBarcode = suggestionCount + (hasBarcode ? 1 : 0)
  return {
    barcodeIndex,
    createIndex: hasCreate ? afterBarcode : -1,
    optionCount: afterBarcode + (hasCreate ? 1 : 0),
  }
}
