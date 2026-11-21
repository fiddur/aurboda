import type { Note } from '@aurboda/api-spec'

import { addDays, format, parseISO } from 'date-fns'

import type { JournalQuery } from '../../state/api'
import type { RelatedFilter } from './related'

/** The local calendar date an entry belongs to: a `day` entry's own date, else its start's date here. */
export const entryDate = (note: Note): string | undefined => {
  if (note.date) return note.date
  if (!note.start_time) return undefined
  const start = new Date(note.start_time)
  return Number.isNaN(start.getTime()) ? undefined : format(start, 'yyyy-MM-dd')
}

export interface JournalDay {
  date: string
  entries: Note[]
}

/**
 * Entries by local day, newest day first. Within a day the `day` entries (no time of day) come
 * first, then the timed ones in the order they arrived (the API answers newest first).
 */
export const groupEntriesByDay = (notes: readonly Note[]): JournalDay[] => {
  const byDate = new Map<string, Note[]>()
  for (const note of notes) {
    const date = entryDate(note)
    if (date === undefined) continue
    const list = byDate.get(date)
    if (list) {
      if (!list.some((n) => n.id === note.id)) list.push(note)
    } else byDate.set(date, [note])
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, entries]) => ({
      date,
      entries: [
        ...entries.filter((n) => n.entity_type === 'day'),
        ...entries.filter((n) => n.entity_type !== 'day'),
      ],
    }))
}

/** "Today", "Yesterday", else the weekday and date, with the year only when it is not this one. */
export const dayHeading = (date: string, today: string): string => {
  if (date === today) return 'Today'
  if (date === format(addDays(parseISO(today), -1), 'yyyy-MM-dd')) return 'Yesterday'
  const day = parseISO(date)
  return date.slice(0, 4) === today.slice(0, 4) ? format(day, 'EEEE d MMMM') : format(day, 'EEEE d MMMM yyyy')
}

/** The time of day a timed entry shows ("14:05", "14:05–15:30"); empty for a `day` entry. */
export const entryTimeLabel = (note: Note): string => {
  if (note.entity_type === 'day' || !note.start_time) return ''
  const start = format(new Date(note.start_time), 'HH:mm')
  if (!note.end_time) return start
  const end = new Date(note.end_time)
  const sameDay = format(end, 'yyyy-MM-dd') === format(new Date(note.start_time), 'yyyy-MM-dd')
  return `${start}–${format(end, sameDay ? 'HH:mm' : 'd MMM HH:mm')}`
}

/** Today's local date, YYYY-MM-DD. */
export const localToday = (now: Date = new Date()): string => format(now, 'yyyy-MM-dd')

/** Whole days left before a deleted entry is removed for good, never below zero. */
export const daysLeft = (purgeAt: string | undefined, now: Date = new Date()): number | undefined => {
  if (!purgeAt) return undefined
  const ms = new Date(purgeAt).getTime() - now.getTime()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

export const daysLeftLabel = (days: number | undefined): string =>
  days === undefined ? '' : days === 0 ? 'removed today' : days === 1 ? '1 day left' : `${days} days left`

/** A short plain-text glimpse of an entry, for one-line rows. */
export const entryGlimpse = (note: Pick<Note, 'title' | 'content'>, max = 90): string => {
  const text = (note.title?.trim() || note.content)
    .replaceAll(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replaceAll(/[#*_`>~]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Text long enough to be clamped in the list with a "Show more". */
export const isLongText = (content: string, maxChars = 480, maxLines = 6): boolean =>
  content.length > maxChars || content.split('\n').length > maxLines

/** What the journal page filters on. */
export interface JournalFilters {
  search: string
  tags: string[]
  jumpTo: string
  withComments: boolean
  needsText: boolean
  related?: RelatedFilter
}

/**
 * The search the filters ask for. Related to someone or something, comments on activities and
 * meals count too: a person's or an activity's page lists them as well.
 */
export const journalQueryFor = (
  filters: JournalFilters,
  q: string,
  tz: string | undefined,
): JournalQuery => ({
  include_comments: filters.withComments || filters.related !== undefined,
  needs_text: filters.needsText,
  q,
  related: filters.related,
  tags: filters.tags,
  to: filters.jumpTo || undefined,
  tz,
})

export const isUnfiltered = (filters: JournalFilters, q: string): boolean =>
  !q.trim() &&
  filters.tags.length === 0 &&
  !filters.jumpTo &&
  !filters.withComments &&
  !filters.needsText &&
  filters.related === undefined
