import { IMPORTANT_DATES_MAX_SPAN_DAYS } from '@aurboda/api-spec'

import { localDateKey } from '../People/people-view'

/** The local dates the Timeline fetches important dates for, clamped to the span the API allows. */
export const importantDatesWindow = (start: Date, end: Date): { from: string; to: string } => {
  const last = new Date(start)
  last.setDate(last.getDate() + IMPORTANT_DATES_MAX_SPAN_DAYS)
  return { from: localDateKey(start), to: localDateKey(end < last ? end : last) }
}
