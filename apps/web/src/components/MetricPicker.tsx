import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'preact/hooks'
import { fetchCustomMetrics, type CustomMetricDefinition } from '../state/api'
import { builtinDashboardMetricOptions, getMetricDisplayName } from '../utils/metricLabels'

import './MetricPicker.css'

interface MetricEntry {
  value: string
  label: string
  group: 'builtin' | 'custom'
}

const buildEntries = (customMetrics: CustomMetricDefinition[]): MetricEntry[] => {
  const builtin: MetricEntry[] = builtinDashboardMetricOptions.map((m) => ({
    group: 'builtin',
    label: m.label,
    value: m.value,
  }))

  const custom: MetricEntry[] = customMetrics.map((m) => ({
    group: 'custom',
    label: m.description ?? m.name,
    value: m.name,
  }))

  return [...builtin, ...custom]
}

interface MetricPickerProps {
  value: string
  onChange: (metric: string) => void
  placeholder?: string
}

export function MetricPicker({ value, onChange, placeholder = 'Search metrics...' }: MetricPickerProps) {
  const [inputValue, setInputValue] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: customMetrics } = useQuery({
    queryFn: fetchCustomMetrics,
    queryKey: ['customMetrics'],
    staleTime: 5 * 60 * 1000,
  })

  const entries = buildEntries(customMetrics ?? [])

  const filtered = entries.filter(
    (entry) =>
      entry.label.toLowerCase().includes(inputValue.toLowerCase()) ||
      entry.value.toLowerCase().includes(inputValue.toLowerCase()),
  )

  // Group filtered entries for display
  const builtinEntries = filtered.filter((e) => e.group === 'builtin')
  const customEntries = filtered.filter((e) => e.group === 'custom')
  const flatFiltered = [...builtinEntries, ...customEntries]

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

  const selectMetric = (metricValue: string) => {
    onChange(metricValue)
    setInputValue('')
    setIsOpen(false)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIsOpen(true)
      setHighlightedIndex((i) => Math.min(i + 1, flatFiltered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && isOpen && flatFiltered.length > 0) {
      e.preventDefault()
      selectMetric(flatFiltered[highlightedIndex].value)
    } else if (e.key === 'Escape') {
      setIsOpen(false)
      setInputValue('')
    }
  }

  const displayValue = value ? getMetricDisplayName(value) : ''
  // Check custom metrics for display name too
  const customDisplayValue =
    value && !displayValue.includes(value) ?
      displayValue
    : ((customMetrics ?? []).find((m) => m.name === value)?.description ?? displayValue)
  const shownValue = isOpen ? inputValue : customDisplayValue || value

  return (
    <div class="metric-picker" ref={containerRef}>
      <input
        ref={inputRef}
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
      {isOpen && flatFiltered.length > 0 && (
        <ul class="metric-picker-dropdown">
          {builtinEntries.length > 0 && <li class="metric-picker-group-header">Built-in</li>}
          {builtinEntries.map((entry) => {
            const idx = flatFiltered.indexOf(entry)
            return (
              <li
                key={entry.value}
                class={`metric-picker-option ${idx === highlightedIndex ? 'highlighted' : ''} ${entry.value === value ? 'selected' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectMetric(entry.value)
                }}
                onMouseEnter={() => setHighlightedIndex(idx)}
              >
                <span class="metric-option-label">{entry.label}</span>
                {entry.label !== entry.value && <span class="metric-option-key">{entry.value}</span>}
              </li>
            )
          })}
          {customEntries.length > 0 && <li class="metric-picker-group-header">Custom</li>}
          {customEntries.map((entry) => {
            const idx = flatFiltered.indexOf(entry)
            return (
              <li
                key={entry.value}
                class={`metric-picker-option ${idx === highlightedIndex ? 'highlighted' : ''} ${entry.value === value ? 'selected' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectMetric(entry.value)
                }}
                onMouseEnter={() => setHighlightedIndex(idx)}
              >
                <span class="metric-option-label">{entry.label}</span>
                {entry.label !== entry.value && <span class="metric-option-key">{entry.value}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
