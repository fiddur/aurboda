import { addMinutes, differenceInMinutes, format, subHours } from 'date-fns'

import type { SetPrefill, SetRow } from './sessionModel'

export const WEIGHT_STEPS = [0.5, 1, 2.5, 5]
export const DEFAULT_WEIGHT_STEP = 2.5

export const SET_TYPES = [
  { label: 'Normal', value: 'normal' },
  { label: 'Warmup', value: 'warmup' },
  { label: 'Drop set', value: 'drop_set' },
  { label: 'Failure', value: 'failure' },
]

export const parseNumber = (text: string): number | undefined => {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return undefined
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : undefined
}

const roundTo = (n: number, step: number): number => {
  const decimals = (String(step).split('.')[1] ?? '').length
  return Number((Math.round(n / step) * step).toFixed(decimals))
}

export const stepValue = (text: string, delta: number): string => {
  const next = (parseNumber(text) ?? 0) + delta
  return String(Math.max(0, roundTo(next, Math.abs(delta))))
}

export interface SetFields {
  weight: string
  reps: string
  time: string
  set_type: string
  rpe: string
  rir: string
  distance: string
  note: string
}

const text = (v: unknown): string => (typeof v === 'number' || typeof v === 'string' ? String(v) : '')

export const fieldsFromSet = (set: SetRow | SetPrefill): SetFields => {
  const row = set as SetRow
  return {
    distance: text(row.distance),
    note: text(row.note),
    reps: text(row.reps),
    rir: text(row.rir),
    rpe: text(row.rpe),
    set_type: text(row.set_type),
    time: text(row.time),
    weight: text(row.weight),
  }
}

const NUMERIC_FIELDS = ['weight', 'reps', 'time', 'rpe', 'rir', 'distance'] as const

/** Every field is present so an edit can clear one; undefined means "not set". */
export const setFromFields = (fields: SetFields): SetRow => ({
  ...Object.fromEntries(NUMERIC_FIELDS.map((f) => [f, parseNumber(fields[f])])),
  note: fields.note.trim() === '' ? undefined : fields.note.trim(),
  set_type: fields.set_type === '' ? undefined : fields.set_type,
})

export const hasMeasure = (fields: SetFields): boolean =>
  ['weight', 'reps', 'time', 'distance'].some((f) => parseNumber(fields[f as keyof SetFields]) !== undefined)

export interface SessionTimes {
  date: string
  time: string
  minutes: string
}

export const defaultTimes = (now: Date): SessionTimes => {
  const start = subHours(now, 1)
  return { date: format(start, 'yyyy-MM-dd'), minutes: '60', time: format(start, 'HH:mm') }
}

export const timesFromActivity = (start: Date, end: Date | undefined): SessionTimes => ({
  date: format(start, 'yyyy-MM-dd'),
  minutes: end ? String(Math.max(0, differenceInMinutes(end, start))) : '60',
  time: format(start, 'HH:mm'),
})

export const sessionInterval = (
  times: SessionTimes,
): { start_time: string; end_time: string } | undefined => {
  const start = new Date(`${times.date}T${times.time}`)
  const minutes = parseNumber(times.minutes)
  if (Number.isNaN(start.getTime()) || minutes === undefined || minutes < 0) return undefined
  return { end_time: addMinutes(start, minutes).toISOString(), start_time: start.toISOString() }
}
