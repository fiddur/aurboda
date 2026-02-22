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
