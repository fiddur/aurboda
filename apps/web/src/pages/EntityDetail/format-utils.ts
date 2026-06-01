import { format } from 'date-fns'

export const formatTime = (d: Date) => format(d, 'HH:mm')

export const formatDateTime = (d: Date) => format(d, 'yyyy-MM-dd HH:mm')

/** Format for <input type="datetime-local"> value binding. */
export const formatDateTimeLocal = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm")

export const formatDuration = (start: Date, end: Date): string => {
  const ms = end.getTime() - start.getTime()
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/** Format a distance (in meters) as `"X.XX km"` for >= 1 km, else `"N m"`. */
export const formatDistance = (meters: number): string => {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`
  return `${Math.round(meters)} m`
}

/**
 * Format a pace (in seconds per kilometer) as `"M:SS /km"`.
 * If `paceSecPerKm` is missing/zero but `speedMps` is provided, derive it.
 */
export const formatPace = (paceSecPerKm: number | undefined, speedMps?: number): string | undefined => {
  const pace =
    paceSecPerKm && paceSecPerKm > 0 ? paceSecPerKm : speedMps && speedMps > 0 ? 1000 / speedMps : undefined
  if (pace === undefined) return undefined
  const totalSec = Math.round(pace)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')} /km`
}

/** Format cadence (steps per minute). */
export const formatCadence = (spm: number): string => `${Math.round(spm)} spm`
