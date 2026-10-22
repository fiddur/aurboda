import { format } from 'date-fns'

export const formatTime = (date: Date, multiDay: boolean): string =>
  multiDay ? format(date, 'MMM d HH:mm') : format(date, 'HH:mm')
