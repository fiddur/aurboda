import { addDays, addMonths, format, formatISO, subDays, subMonths } from 'date-fns'
import { useRef, useState } from 'preact/hooks'

import './DateNav.css'

interface DateNavProps {
  /** Current date (for single-date mode). */
  value: string // YYYY-MM-DD
  /** Called when the date changes. */
  onChange: (date: string) => void
  /** Format for the displayed date label. Defaults to 'EEE, MMM d'. */
  dateFormat?: string
  /** If true, disable navigating past today. */
  maxToday?: boolean
  /** Extra class name. */
  class?: string
}

interface DateRangeNavProps {
  /** Start date. */
  from: string // YYYY-MM-DD
  /** End date. */
  to: string // YYYY-MM-DD
  /** Called when the range changes. */
  onChange: (from: string, to: string) => void
  /** Label to display (caller controls formatting). */
  label: string
  /** If true, disable navigating past today. */
  maxToday?: boolean
  /** Extra class name. */
  class?: string
}

const toISODate = (d: Date): string => formatISO(d, { representation: 'date' })
const todayStr = (): string => toISODate(new Date())

/** Single-date navigation with day/month arrows and click-to-pick calendar. */
export function DateNav({
  value,
  onChange,
  dateFormat = 'EEE, MMM d',
  maxToday = true,
  ...rest
}: DateNavProps) {
  const dateInputRef = useRef<HTMLInputElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const date = new Date(value)
  const isToday = value === todayStr()
  const label = isToday ? 'Today' : format(date, dateFormat)

  const jump = (newDate: Date) => {
    const iso = toISODate(newDate)
    if (maxToday && iso > todayStr()) return
    onChange(iso)
  }

  const handleDatePick = (e: Event) => {
    const target = e.target as HTMLInputElement
    if (target.value) {
      onChange(target.value)
      setPickerOpen(false)
    }
  }

  const openPicker = () => {
    setPickerOpen(true)
    // Delay to let the input render, then open its native picker
    requestAnimationFrame(() => {
      dateInputRef.current?.showPicker?.()
      dateInputRef.current?.focus()
    })
  }

  return (
    <div class={`date-nav ${rest.class ?? ''}`}>
      <button type="button" class="nav-btn" onClick={() => jump(subMonths(date, 1))} title="Back 1 month">
        {'<<'}
      </button>
      <button type="button" class="nav-btn" onClick={() => jump(subDays(date, 1))} title="Back 1 day">
        {'<'}
      </button>

      <button type="button" class="nav-date-label" onClick={openPicker} title="Pick a date">
        {label}
      </button>

      {pickerOpen && (
        <input
          ref={dateInputRef}
          type="date"
          class="nav-date-picker"
          value={value}
          max={maxToday ? todayStr() : undefined}
          onChange={handleDatePick}
          onBlur={() => setPickerOpen(false)}
        />
      )}

      <button
        type="button"
        class="nav-btn"
        onClick={() => jump(addDays(date, 1))}
        title="Forward 1 day"
        disabled={maxToday && isToday}
      >
        {'>'}
      </button>
      <button
        type="button"
        class="nav-btn"
        onClick={() => jump(addMonths(date, 1))}
        title="Forward 1 month"
        disabled={maxToday && toISODate(addMonths(date, 1)) > todayStr()}
      >
        {'>>'}
      </button>
    </div>
  )
}

/** Date-range navigation with day/month arrows and click-to-pick start/end. */
export function DateRangeNav({ from, to, onChange, label, maxToday = true, ...rest }: DateRangeNavProps) {
  const fromInputRef = useRef<HTMLInputElement>(null)
  const toInputRef = useRef<HTMLInputElement>(null)
  const [editingField, setEditingField] = useState<'from' | 'to' | null>(null)

  const fromDate = new Date(from)
  const toDate = new Date(to)
  const rangeDays = Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24))

  const jumpDays = (days: number) => {
    const newFrom = toISODate(addDays(fromDate, days))
    const newTo = toISODate(addDays(toDate, days))
    if (maxToday && newTo > todayStr()) return
    onChange(newFrom, newTo)
  }

  const jumpMonths = (months: number) => {
    const newFrom = toISODate(addMonths(fromDate, months))
    let newTo = toISODate(addMonths(toDate, months))
    if (maxToday && newTo > todayStr()) newTo = todayStr()
    onChange(newFrom, newTo)
  }

  const handleFromPick = (e: Event) => {
    const val = (e.target as HTMLInputElement).value
    if (val && val <= to) {
      onChange(val, to)
    }
    setEditingField(null)
  }

  const handleToPick = (e: Event) => {
    const val = (e.target as HTMLInputElement).value
    if (val && val >= from) {
      onChange(from, val)
    }
    setEditingField(null)
  }

  const openFromPicker = () => {
    setEditingField('from')
    requestAnimationFrame(() => {
      fromInputRef.current?.showPicker?.()
      fromInputRef.current?.focus()
    })
  }

  const openToPicker = () => {
    setEditingField('to')
    requestAnimationFrame(() => {
      toInputRef.current?.showPicker?.()
      toInputRef.current?.focus()
    })
  }

  return (
    <div class={`date-nav ${rest.class ?? ''}`}>
      <button type="button" class="nav-btn" onClick={() => jumpMonths(-1)} title="Back 1 month">
        {'<<'}
      </button>
      <button type="button" class="nav-btn" onClick={() => jumpDays(-1)} title="Back 1 day">
        {'<'}
      </button>

      <span class="nav-date-label nav-range-label">
        <button type="button" class="nav-range-btn" onClick={openFromPicker} title="Pick start date">
          {format(fromDate, 'MMM d')}
        </button>
        {' – '}
        <button type="button" class="nav-range-btn" onClick={openToPicker} title="Pick end date">
          {format(toDate, rangeDays > 365 ? 'MMM d, yyyy' : 'MMM d, yyyy')}
        </button>
      </span>

      {editingField === 'from' && (
        <input
          ref={fromInputRef}
          type="date"
          class="nav-date-picker"
          value={from}
          max={to}
          onChange={handleFromPick}
          onBlur={() => setEditingField(null)}
        />
      )}
      {editingField === 'to' && (
        <input
          ref={toInputRef}
          type="date"
          class="nav-date-picker"
          value={to}
          max={maxToday ? todayStr() : undefined}
          onChange={handleToPick}
          onBlur={() => setEditingField(null)}
        />
      )}

      <button
        type="button"
        class="nav-btn"
        onClick={() => jumpDays(1)}
        title="Forward 1 day"
        disabled={maxToday && to >= todayStr()}
      >
        {'>'}
      </button>
      <button
        type="button"
        class="nav-btn"
        onClick={() => jumpMonths(1)}
        title="Forward 1 month"
        disabled={maxToday && to >= todayStr()}
      >
        {'>>'}
      </button>
    </div>
  )
}
