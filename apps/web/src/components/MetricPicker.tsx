import type { MetricCatalogEntry } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'preact/hooks'

import { fetchCustomMetrics, fetchMetricCatalog, type CustomMetricDefinition } from '../state/api'
import { builtinDashboardMetricOptions, getMetricDisplayName } from '../utils/metricLabels'
import { matchMetricEntries } from './picker-match'
import './MetricPicker.css'

interface MetricEntry {
  value: string
  label: string
  group: 'builtin' | 'custom' | 'catalog'
  keywords?: string[]
}

const buildEntries = (
  customMetrics: CustomMetricDefinition[],
  catalogEntries: MetricCatalogEntry[],
): MetricEntry[] => {
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

  const catalog: MetricEntry[] = catalogEntries
    .filter((entry) => !entry.in_use)
    .map((entry) => ({
      group: 'catalog',
      keywords: entry.aliases,
      label: entry.display_name,
      value: entry.name,
    }))

  return [...builtin, ...custom, ...catalog]
}

/**
 * The label to show in the closed input for the selected value: the built-in
 * display name, else the matching custom metric's description, else the raw value.
 */
const displayNameForValue = (
  value: string,
  customMetrics: CustomMetricDefinition[],
  catalogEntries: MetricCatalogEntry[],
): string => {
  const displayValue = value ? getMetricDisplayName(value) : ''
  const customDisplayValue =
    value && !displayValue.includes(value)
      ? displayValue
      : (customMetrics.find((m) => m.name === value)?.description ??
        catalogEntries.find((entry) => entry.name === value)?.display_name ??
        displayValue)
  return customDisplayValue || value
}

const groupHeadings: Record<MetricEntry['group'], string> = {
  builtin: 'Built-in',
  catalog: 'More built-in metrics',
  custom: 'Custom',
}

const groupOrder: MetricEntry['group'][] = ['builtin', 'custom', 'catalog']

interface MetricPickerProps {
  value: string
  onChange: (metric: string) => void
  placeholder?: string
  /** Offer only built-in metrics (hide the user's custom metrics) — e.g. article
   *  chart blocks accept only built-in `MetricType`s. */
  builtinOnly?: boolean
  /** Also offer the catalogue metrics the user has not used yet; only where a value is written, since
   *  such a metric has no data. */
  includeCatalog?: boolean
}

export function MetricPicker({
  value,
  onChange,
  placeholder = 'Search metrics...',
  builtinOnly = false,
  includeCatalog = false,
}: MetricPickerProps) {
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

  const { data: metricCatalog } = useQuery({
    enabled: includeCatalog && !builtinOnly,
    queryFn: fetchMetricCatalog,
    queryKey: ['metricCatalog'],
    staleTime: 30 * 60 * 1000,
  })
  const catalogEntries = includeCatalog && !builtinOnly ? (metricCatalog?.entries ?? []) : []

  const entries = buildEntries(builtinOnly ? [] : (customMetrics ?? []), catalogEntries)

  const filtered = matchMetricEntries(entries, inputValue)

  const groups = groupOrder.map((group) => ({ entries: filtered.filter((e) => e.group === group), group }))
  const flatFiltered = groups.flatMap((g) => g.entries)

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

  const shownValue = isOpen ? inputValue : displayNameForValue(value, customMetrics ?? [], catalogEntries)

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
          {groups.map(({ entries: groupEntries, group }) =>
            groupEntries.length === 0
              ? null
              : [
                  <li key={`heading-${group}`} class="metric-picker-group-header">
                    {groupHeadings[group]}
                  </li>,
                  ...groupEntries.map((entry) => {
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
                  }),
                ],
          )}
        </ul>
      )}
    </div>
  )
}
