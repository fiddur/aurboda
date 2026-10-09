import type { ActivitySessions, DataSchemaDefinition } from '@aurboda/api-spec'

import type { Activity } from '../../state/api'

import { formatMinutesAsHM } from '../../components/charts/sleep-utils'
import { fieldLabel } from '../../components/sessions/sessionView'
import {
  formatCadence,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatPace,
  formatTime,
} from './format-utils'

export interface ActivityStatRow {
  label: string
  value: string
  href?: string
  title?: string
  /** Name of a categorical schema field without a value, shown so it can be filled in. */
  missingField?: string
}

export interface BuildActivityStatRowsInput {
  activity: Activity
  displayStart: Date
  displayEnd: Date | undefined
  durationLabel: string
  totalCalories: number | undefined
  sleepMinutes: number | undefined
}

export const buildTimeRows = ({
  displayStart,
  displayEnd,
  durationLabel,
}: Pick<BuildActivityStatRowsInput, 'displayStart' | 'displayEnd' | 'durationLabel'>): ActivityStatRow[] => {
  const rows: ActivityStatRow[] = [
    {
      label: 'Time',
      value: displayEnd
        ? `${formatDateTime(displayStart)} – ${formatTime(displayEnd)}`
        : formatDateTime(displayStart),
    },
  ]
  if (displayEnd) rows.push({ label: durationLabel, value: formatDuration(displayStart, displayEnd) })
  return rows
}

const formatCalories = (
  total: number | undefined,
  active: number | undefined,
): ActivityStatRow | undefined => {
  if (total !== undefined) {
    const activePart = active === undefined ? '' : ` · ${active} active`
    return { label: 'Calories', value: `${Math.round(total)} kcal${activePart}` }
  }
  return active === undefined ? undefined : { label: 'Active Calories', value: `${active} kcal` }
}

const formatElevation = (gain: number | undefined, loss: number | undefined): string | undefined => {
  const parts = [
    gain === undefined ? undefined : `+${Math.round(gain)} m`,
    loss === undefined ? undefined : `−${Math.round(loss)} m`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : undefined
}

export const garminConnectActivityUrl = (id: number | string): string =>
  `https://connect.garmin.com/modern/activity/${id}`

const MIN_TYPICAL_SESSIONS = 3

export const typicalAvgHr = (
  sessions: ActivitySessions | undefined,
  field: string,
  value: string,
): { median: number; count: number } | undefined => {
  if (sessions?.group_by !== field) return undefined
  const group = sessions.groups?.find((g) => g.value !== null && String(g.value) === value)
  if (!group || group.avg_hr_count < MIN_TYPICAL_SESSIONS || group.avg_hr_median === undefined) {
    return undefined
  }
  return { count: group.avg_hr_count, median: group.avg_hr_median }
}

export interface TypicalAvgHr {
  median: number
  count: number
  value: string
  field_label: string
}

const avgHrRow = (avgHr: number, typical: TypicalAvgHr | undefined): ActivityStatRow => {
  const own = `${Math.round(avgHr)} bpm`
  if (!typical) return { label: 'Avg HR', value: own }
  return {
    label: 'Avg HR',
    title: `Median average heart rate over ${typical.count} sessions with the same ${typical.field_label}`,
    value: `${own} · typically ${Math.round(typical.median)} (${typical.count} ${typical.value})`,
  }
}

// eslint-disable-next-line complexity -- one optional row per summary metric
export const buildMetricRows = ({
  activity,
  totalCalories,
  sleepMinutes,
  typicalAvgHr: typical,
}: Pick<BuildActivityStatRowsInput, 'activity' | 'totalCalories' | 'sleepMinutes'> & {
  typicalAvgHr?: TypicalAvgHr
}): ActivityStatRow[] => {
  const rows: ActivityStatRow[] = []
  const add = (label: string, value: string | undefined) => {
    if (value !== undefined) rows.push({ label, value })
  }
  const a = activity
  add('Distance', a.distance === undefined ? undefined : formatDistance(a.distance))
  add('Avg Pace', formatPace(a.avg_pace, a.avg_speed))
  add('Avg Cadence', a.avg_cadence === undefined ? undefined : formatCadence(a.avg_cadence))
  add('Avg Power', a.avg_power === undefined ? undefined : `${Math.round(a.avg_power)} W`)
  add('Elevation', formatElevation(a.elevation_gain, a.elevation_loss))
  if (a.avg_hr !== undefined) rows.push(avgHrRow(a.avg_hr, typical))
  add('Max HR', a.max_hr === undefined ? undefined : `${Math.round(a.max_hr)} bpm`)
  const calories = formatCalories(a.calories, totalCalories)
  if (calories) rows.push(calories)
  add('Steps', a.steps ? String(Math.round(a.steps)) : undefined)
  add(
    'Body Battery',
    a.body_battery_before !== undefined && a.body_battery_after !== undefined
      ? `${a.body_battery_before} → ${a.body_battery_after}`
      : undefined,
  )
  add('VO2 Max', a.vo2_max === undefined ? undefined : `${a.vo2_max} mL/kg/min`)
  add('Asleep', sleepMinutes === undefined ? undefined : formatMinutesAsHM(sleepMinutes))
  add('Avg HRV', a.avg_hrv === undefined ? undefined : `${a.avg_hrv} ms`)
  return rows
}

export const buildActivityStatRows = (input: BuildActivityStatRowsInput): ActivityStatRow[] => [
  ...buildTimeRows(input),
  ...buildMetricRows(input),
]

const RULE_KEYS: [key: string, label: string][] = [
  ['rule_id', 'Created by rule'],
  ['_enriched_by', 'Enriched by'],
  ['_retyped_by', 'Retyped by'],
]

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

const formatFieldValue = (value: unknown, unit?: string): string => {
  const str = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
  return unit ? `${str} ${unit}` : str
}

/**
 * The type's declared data fields with a value, an empty categorical field as a row to fill in,
 * and links to the deduction rules that created, enriched or retyped the activity.
 */
export const buildFieldRows = (
  schema: DataSchemaDefinition | undefined,
  data: Record<string, unknown> | undefined,
  referencedRules: Record<string, string> | undefined,
): ActivityStatRow[] => {
  const rows: ActivityStatRow[] = []
  for (const field of schema?.fields ?? []) {
    const value = data?.[field.name]
    if (!isBlank(value)) {
      rows.push({ label: fieldLabel(field), value: formatFieldValue(value, field.unit) })
    } else if (field.is_categorical) {
      rows.push({ label: fieldLabel(field), missingField: field.name, value: '' })
    }
  }
  for (const [key, label] of RULE_KEYS) {
    const ruleId = data?.[key]
    if (typeof ruleId !== 'string') continue
    rows.push({
      href: `/deduction-rules/${ruleId}`,
      label,
      value: referencedRules?.[ruleId] ?? `${ruleId.slice(0, 8)}…`,
    })
  }
  return rows
}

/** Source keys the summary already shows (as a metric, or as the activity's own times). */
const SHOWN_DATA_KEYS = new Set([
  'average_hr',
  'calories',
  'detail_synced',
  'distance',
  'elevation_gain',
  'endTime',
  'max_hr',
  'rule_name',
  'startTime',
  'steps',
  'vo2_max',
  ...RULE_KEYS.map(([key]) => key),
])

const LONG_ARRAY = 10

const formatSourceValue = (value: unknown): string => {
  if (Array.isArray(value) && value.length > LONG_ARRAY) return `${value.length} items`
  if (typeof value === 'object' && value !== null) return JSON.stringify(value, null, 2)
  return String(value)
}

const keyLabel = (key: string) => key.charAt(0).toUpperCase() + key.slice(1).replaceAll('_', ' ')

/** The rest of the source's `data`: what neither the schema rows nor the summary already show. */
export const sourceDataEntries = (
  data: Record<string, unknown> | undefined,
  schema: DataSchemaDefinition | undefined,
): { key: string; label: string; value: string }[] => {
  const declared = new Set(schema?.fields.map((f) => f.name))
  return Object.entries(data ?? {})
    .filter(([key, value]) => !declared.has(key) && !SHOWN_DATA_KEYS.has(key) && !isBlank(value))
    .map(([key, value]) => ({ key, label: keyLabel(key), value: formatSourceValue(value) }))
}
