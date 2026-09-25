import { format } from 'date-fns'

/** Includes a date prefix when the view spans multiple days. */
export const formatTime = (date: Date, multiDay: boolean): string =>
  multiDay ? format(date, 'MMM d HH:mm') : format(date, 'HH:mm')
