import type { NoteNeighbor } from '@aurboda/api-spec'

import { format, parseISO } from 'date-fns'

import type { EntryForm } from './entry-form'

export const NEIGHBOR_EXCERPT_MAX = 40

export const neighborDate = (n: Pick<NoteNeighbor, 'date' | 'start_time'>): string => {
  if (n.date) return format(parseISO(n.date), 'd MMM yyyy')
  if (n.start_time) return format(new Date(n.start_time), 'd MMM yyyy')
  return ''
}

/** The title, or else the first line of the text, cut short. */
export const neighborText = (n: Pick<NoteNeighbor, 'title' | 'excerpt'>): string => {
  const title = n.title?.trim()
  if (title) return title
  const excerpt = n.excerpt.trim()
  return excerpt.length > NEIGHBOR_EXCERPT_MAX
    ? `${excerpt.slice(0, NEIGHBOR_EXCERPT_MAX - 1).trimEnd()}…`
    : excerpt
}

export const neighborLabel = (n: NoteNeighbor): string =>
  [neighborDate(n), neighborText(n)].filter((part) => part !== '').join(' · ')

/** Where the entry sits in the Journal: a change refetches its neighbours. */
export const neighborAnchorKey = (form: Pick<EntryForm, 'allDay' | 'date' | 'start'>): string =>
  form.allDay ? `day:${form.date}` : `time:${form.start}`

export const journalEntryHref = (id: string): string => `/journal/${encodeURIComponent(id)}`
