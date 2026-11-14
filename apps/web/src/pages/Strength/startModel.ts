import { differenceInMinutes, format, formatDistanceStrict, isSameDay, subDays } from 'date-fns'

import { exerciseNames, isInProgress, setsOfData, type SetRow } from './sessionModel'

export interface StrengthActivity {
  id?: string
  start_time: Date
  end_time?: Date
  data?: Record<string, unknown>
}

export interface RepeatCandidate {
  id: string
  start_time: Date
  minutes?: number
  names: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000
export const UNFINISHED_DAYS = 7
export const REPEAT_DAYS = 90
export const REPEAT_COUNT = 5

const newestFirst = <T extends { start_time: Date }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => b.start_time.getTime() - a.start_time.getTime())

export const unfinishedOnServer = <T extends StrengthActivity>(activities: T[], now: Date): T | undefined =>
  newestFirst(activities).find(
    (a) => a.id && isInProgress(a.data) && now.getTime() - a.start_time.getTime() <= UNFINISHED_DAYS * DAY_MS,
  )

export const repeatCandidates = (activities: StrengthActivity[], excludeId?: string): RepeatCandidate[] =>
  newestFirst(activities)
    .flatMap((a) => {
      const sets = setsOfData(a.data)
      if (!a.id || a.id === excludeId || !a.end_time || isInProgress(a.data) || sets.length === 0) return []
      const minutes = differenceInMinutes(a.end_time, a.start_time)
      return [{ id: a.id, minutes, names: exerciseNames(sets), start_time: a.start_time }]
    })
    .slice(0, REPEAT_COUNT)

export const recentSessionSets = (activities: StrengthActivity[], excludeId?: string): SetRow[][] =>
  newestFirst(activities)
    .filter((a) => a.id !== excludeId)
    .map((a) => setsOfData(a.data))
    .filter((sets) => sets.length > 0)

export const exerciseListLabel = (names: string[], shown = 3): string => {
  if (names.length <= shown) return names.join(', ')
  return `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`
}

export const sessionDateLabel = (start: Date, minutes?: number): string =>
  minutes === undefined ? format(start, 'EEE d MMM') : `${format(start, 'EEE d MMM')}, ${minutes} min`

export const startedLabel = (start: Date, now: Date): string => {
  const time = format(start, 'HH:mm')
  if (isSameDay(start, now)) return `Started today at ${time}`
  if (isSameDay(start, subDays(now, 1))) return `Started yesterday at ${time}`
  return `Started ${format(start, 'EEE d MMM')} at ${time}`
}

export const lastSetLabel = (lastSetAt: string | undefined, now: Date): string | undefined =>
  lastSetAt ? `Last set ${formatDistanceStrict(new Date(lastSetAt), now)} ago.` : undefined
