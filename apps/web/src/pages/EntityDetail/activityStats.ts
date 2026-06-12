import type { Activity } from '../../state/api'

import {
  formatCadence,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatPace,
  formatTime,
} from './format-utils'
import { formatMinutesAsHM } from './sleep-utils'

export interface ActivityStatRow {
  label: string
  value: string
}

export interface BuildActivityStatRowsInput {
  activity: Activity
  displayStart: Date
  displayEnd: Date | undefined
  durationLabel: string
  totalCalories: number | undefined
  sleepMinutes: number | undefined
  notes: string
}

/**
 * Build the rows shown in the read-only activity summary table.
 * Returns Time, Duration, and any populated metric/note rows in display order.
 */
export const buildActivityStatRows = ({
  activity,
  displayStart,
  displayEnd,
  durationLabel,
  totalCalories,
  sleepMinutes,
  notes,
}: BuildActivityStatRowsInput): ActivityStatRow[] => {
  const rows: ActivityStatRow[] = []
  rows.push({
    label: 'Time',
    value: displayEnd
      ? `${formatDateTime(displayStart)} – ${formatTime(displayEnd)}`
      : formatDateTime(displayStart),
  })
  if (displayEnd) rows.push({ label: durationLabel, value: formatDuration(displayStart, displayEnd) })
  if (activity.distance !== undefined) {
    rows.push({ label: 'Distance', value: formatDistance(activity.distance) })
  }
  const pace = formatPace(activity.avg_pace, activity.avg_speed)
  if (pace !== undefined) rows.push({ label: 'Avg Pace', value: pace })
  if (activity.avg_cadence !== undefined) {
    rows.push({ label: 'Avg Cadence', value: formatCadence(activity.avg_cadence) })
  }
  if (activity.avg_hr !== undefined) {
    rows.push({ label: 'Avg HR', value: `${Math.round(activity.avg_hr)} bpm` })
  }
  if (activity.max_hr !== undefined) {
    rows.push({ label: 'Max HR', value: `${Math.round(activity.max_hr)} bpm` })
  }
  if (totalCalories !== undefined) rows.push({ label: 'Active Calories', value: `${totalCalories} kcal` })
  if (sleepMinutes !== undefined) rows.push({ label: 'Asleep', value: formatMinutesAsHM(sleepMinutes) })
  if (activity.avg_hrv !== undefined) rows.push({ label: 'Avg HRV', value: `${activity.avg_hrv} ms` })
  if (notes) rows.push({ label: 'Notes', value: notes })
  return rows
}
