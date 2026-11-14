import type { ImpactDimensionOption, ImpactFilter } from '@aurboda/api-spec'

import { useEffect, useState } from 'preact/hooks'

import {
  describeFilterCount,
  formatLimits,
  isFilterKeyOn,
  parseLimitsInput,
  toggleFilterKey,
} from './slicing'

const MAX_COLLAPSED_CHIPS = 8

type LimitsKind = 'duration' | 'time_of_day'

const LIMITS_UNIT: Record<LimitsKind, string> = { duration: 'min', time_of_day: 'hour' }

const isLimitsKind = (dimension: string): dimension is LimitsKind =>
  dimension === 'duration' || dimension === 'time_of_day'

function LimitsInput({
  kind,
  label,
  limits,
  onChange,
}: {
  kind: LimitsKind
  label: string
  limits: readonly number[]
  onChange: (limits: number[]) => void
}) {
  const formatted = formatLimits(limits)
  const [text, setText] = useState(formatted)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setText(formatted)
    setError(null)
  }, [formatted])

  const commit = () => {
    const parsed = parseLimitsInput(text, kind)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    setError(null)
    if (formatLimits(parsed.limits) === formatted) setText(formatted)
    else onChange(parsed.limits)
  }

  return (
    <label class="limits-input">
      <span class="limits-label">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        aria-invalid={error !== null}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
      {error && (
        <span class="limits-error" role="alert">
          {error}
        </span>
      )}
    </label>
  )
}

interface LimitsProps {
  lengths: readonly number[]
  hours: readonly number[]
  onLengthsChange: (limits: number[]) => void
  onHoursChange: (limits: number[]) => void
}

function DimensionLimits({ kind, label, ...props }: LimitsProps & { kind: LimitsKind; label: string }) {
  return kind === 'duration' ? (
    <LimitsInput kind={kind} label={label} limits={props.lengths} onChange={props.onLengthsChange} />
  ) : (
    <LimitsInput kind={kind} label={label} limits={props.hours} onChange={props.onHoursChange} />
  )
}

function ChipRow({
  option,
  filters,
  onToggle,
  limits,
}: {
  option: ImpactDimensionOption
  filters: readonly ImpactFilter[]
  onToggle: (key: string) => void
  limits: LimitsProps
}) {
  const [expanded, setExpanded] = useState(false)
  const isOn = (key: string) => isFilterKeyOn(filters, option.dimension, key)
  const visible =
    expanded || option.groups.length <= MAX_COLLAPSED_CHIPS
      ? option.groups
      : option.groups.filter((g, i) => i < MAX_COLLAPSED_CHIPS || isOn(g.key))
  const hidden = option.groups.length - visible.length
  return (
    <div class="slicer-dimension">
      <div class="slicer-dimension-label">
        {option.label}
        {isLimitsKind(option.dimension) && (
          <DimensionLimits
            kind={option.dimension}
            label={`limits, ${LIMITS_UNIT[option.dimension]}`}
            {...limits}
          />
        )}
      </div>
      <div class="slicer-chips" role="group" aria-label={option.label}>
        {visible.map((g) => {
          const on = isOn(g.key)
          return (
            <button
              key={g.key}
              type="button"
              class="slicer-chip"
              aria-pressed={on}
              disabled={!on && g.occurrences === 0}
              onClick={() => onToggle(g.key)}
            >
              {g.label} <span class="chip-count">· {g.occurrences}</span>
            </button>
          )
        })}
        {hidden > 0 && (
          <button type="button" class="slicer-more" onClick={() => setExpanded(true)}>
            Show {hidden} more
          </button>
        )}
        {option.omitted_groups > 0 && (
          <span class="slicer-omitted">
            and {option.omitted_groups} more {option.omitted_groups === 1 ? 'value' : 'values'} with fewer
            sessions
          </span>
        )}
      </div>
    </div>
  )
}

/** Break down by and Filter sessions for the selected row, drawn from the dimensions the server lists. */
export function ImpactSlicer({
  dimensions,
  breakdown,
  filters,
  occurrences,
  totalOccurrences,
  onBreakdownChange,
  onFiltersChange,
  ...limits
}: LimitsProps & {
  dimensions: readonly ImpactDimensionOption[] | undefined
  breakdown: string
  filters: readonly ImpactFilter[]
  occurrences: number
  totalOccurrences: number
  onBreakdownChange: (dimension: string) => void
  onFiltersChange: (filters: ImpactFilter[]) => void
}) {
  const [open, setOpen] = useState(filters.length > 0)
  const listed = dimensions ?? []
  const unlisted = breakdown !== '' && !listed.some((d) => d.dimension === breakdown)
  return (
    <div class="impact-slicer">
      <div class="slicer-row">
        <label class="slicer-breakdown">
          Break down by{' '}
          <select
            class="period-select"
            value={breakdown}
            onChange={(e) => onBreakdownChange((e.target as HTMLSelectElement).value)}
          >
            <option value="">None</option>
            {listed.map((d) => (
              <option key={d.dimension} value={d.dimension}>
                {d.label}
              </option>
            ))}
            {unlisted && <option value={breakdown}>{breakdown}</option>}
          </select>
        </label>
        {isLimitsKind(breakdown) && (
          <DimensionLimits
            kind={breakdown}
            label={breakdown === 'duration' ? 'Length limits (min)' : 'Time of day limits (hour)'}
            {...limits}
          />
        )}
      </div>
      <details
        class="slicer-filters"
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>
          Filter sessions{filters.length > 0 && ` (${filters.length} active)`}
          <span class="slicer-count"> · {describeFilterCount(occurrences, totalOccurrences)}</span>
          {filters.length > 0 && (
            <button
              type="button"
              class="slicer-clear"
              onClick={(e) => {
                e.preventDefault()
                onFiltersChange([])
              }}
            >
              Clear filters
            </button>
          )}
        </summary>
        {listed.map((option) => (
          <ChipRow
            key={option.dimension}
            option={option}
            filters={filters}
            limits={limits}
            onToggle={(key) => onFiltersChange(toggleFilterKey(filters, option.dimension, key))}
          />
        ))}
      </details>
      {occurrences === 0 && totalOccurrences > 0 && (
        <p class="slicer-empty">No sessions match these filters.</p>
      )}
    </div>
  )
}
