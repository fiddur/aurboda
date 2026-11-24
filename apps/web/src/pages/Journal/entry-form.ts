import type { AddNoteBody, Note, UpdateNoteBody } from '@aurboda/api-spec'

import { extractHashtags, normalizeTag } from '@aurboda/api-spec'
import { addDays, format } from 'date-fns'

import { fromDatetimeLocal, toDatetimeLocal } from '../../components/CommentThread/datetimeLocal'
import { timelineHref } from '../Timeline/viewHash'
import { linksToInput, type RelatedLink, sameLinks } from './related'

/** What the editor holds. `start`/`end` are datetime-local values; `date` is YYYY-MM-DD. */
export interface EntryForm {
  title: string
  content: string
  /** The tags set by hand; the #hashtags in the text are tags too without being listed here. */
  tags: string[]
  /** On: a `day` entry pinned to `date`. Off: a `time` entry from `start` (to `end`). */
  allDay: boolean
  date: string
  start: string
  end: string
  related: RelatedLink[]
}

export const emptyEntryForm = (now: Date = new Date(), content = ''): EntryForm => ({
  allDay: false,
  content,
  date: format(now, 'yyyy-MM-dd'),
  end: '',
  related: [],
  start: toDatetimeLocal(now),
  tags: [],
  title: '',
})

/** A `day` entry shows its date in the time fields too, so switching kinds keeps the day. */
export const formFromNote = (note: Note): EntryForm => {
  const hashtags = new Set(extractHashtags(note.content))
  const start = note.start_time ? toDatetimeLocal(note.start_time) : ''
  const date = note.date ?? (start ? start.slice(0, 10) : format(new Date(), 'yyyy-MM-dd'))
  return {
    allDay: note.entity_type === 'day',
    content: note.content,
    date,
    end: note.end_time ? toDatetimeLocal(note.end_time) : '',
    related: note.related ?? [],
    start: start || `${date}T12:00`,
    tags: (note.tags ?? []).filter((tag) => !hashtags.has(tag)),
    title: note.title ?? '',
  }
}

export interface TagChip {
  tag: string
  /** Typed as a #hashtag in the text: it goes when the text loses it, not from the chip. */
  fromText: boolean
}

/** The explicit tags, then the text's #hashtags not already among them. */
export const tagChips = (tags: readonly string[], content: string): TagChip[] => {
  const explicit = tags.map((tag) => ({ fromText: false, tag }))
  const fromText = extractHashtags(content)
    .filter((tag) => !tags.includes(tag))
    .map((tag) => ({ fromText: true, tag }))
  return [...explicit, ...fromText]
}

/** `tags` with what was typed added (comma- or space-separated, `#` optional); invalid words are left out. */
export const addTags = (tags: readonly string[], typed: string): { tags: string[]; rejected: string[] } => {
  const out = [...tags]
  const rejected: string[] = []
  for (const word of typed.split(/[\s,]+/).filter((w) => w.length > 0)) {
    const tag = normalizeTag(word)
    if (tag === null) rejected.push(word)
    else if (!out.includes(tag)) out.push(tag)
  }
  return { rejected, tags: out }
}

/** Why the form cannot be saved as it stands, if it cannot. */
export const entryFormProblem = (form: EntryForm): string | undefined => {
  if (form.allDay) return /^\d{4}-\d{2}-\d{2}$/.test(form.date) ? undefined : 'Pick a date.'
  const start = fromDatetimeLocal(form.start)
  if (!start) return 'Pick a date and time.'
  const end = fromDatetimeLocal(form.end)
  if (end && end < start) return 'The end is before the start.'
  return undefined
}

const anchorFields = (form: EntryForm) =>
  form.allDay
    ? { date: form.date }
    : {
        start_time: fromDatetimeLocal(form.start)!.toISOString(),
        ...(form.end ? { end_time: fromDatetimeLocal(form.end)!.toISOString() } : {}),
      }

export const formToCreateBody = (form: EntryForm): AddNoteBody => ({
  content: form.content,
  entity_type: form.allDay ? 'day' : 'time',
  ...(form.related.length > 0 ? { related: linksToInput(form.related) } : {}),
  tags: form.tags,
  title: form.title.trim() || null,
  ...anchorFields(form),
})

/** `related` is sent only when the links differ from `savedRelated`, the ones the server last confirmed. */
export const formToUpdateBody = (
  form: EntryForm,
  expectedUpdatedAt: string | undefined,
  savedRelated: readonly RelatedLink[] = [],
): UpdateNoteBody => ({
  content: form.content,
  ...(sameLinks(form.related, savedRelated) ? {} : { related: linksToInput(form.related) }),
  tags: form.tags,
  title: form.title.trim() || null,
  ...(form.allDay
    ? { date: form.date }
    : { end_time: form.end ? fromDatetimeLocal(form.end)!.toISOString() : null, ...anchorFields(form) }),
  ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {}),
})

/** Nothing written, no title and no pictures or recordings: such an entry is not kept. */
export const isEntryEmpty = (form: Pick<EntryForm, 'title' | 'content'>, attachmentCount: number): boolean =>
  form.title.trim() === '' && form.content.trim() === '' && attachmentCount === 0

/**
 * Whether leaving the editor throws the entry away. Only an entry this visit started from `/journal/new`
 * is: an editor opened on a saved entry can be unmounted before its load lands (the router remounts the
 * old route while the next one loads), and its form is then the empty initial one, not the entry's.
 */
export const discardOnLeave = (
  opened: { savedEntry: boolean; deleted: boolean },
  isEmpty: boolean,
): boolean => !opened.savedEntry && !opened.deleted && isEmpty

/** Two forms say the same thing to the server. */
export const sameEntry = (a: EntryForm, b: EntryForm): boolean =>
  a.title.trim() === b.title.trim() &&
  a.content === b.content &&
  a.tags.join(',') === b.tags.join(',') &&
  sameLinks(a.related, b.related) &&
  a.allDay === b.allDay &&
  (a.allDay ? a.date === b.date : a.start === b.start && a.end === b.end)

/** The local day the entry is on, for picking that day's activities. */
/** The Timeline around the entry: its whole day for a day entry, else the 24 hours around its time. */
export const entryTimelineHref = (
  form: Pick<EntryForm, 'allDay' | 'date' | 'start' | 'end'>,
): string | undefined => {
  if (form.allDay) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(form.date) ? fromDatetimeLocal(`${form.date}T00:00`) : undefined
    return day ? timelineHref(day, addDays(day, 1)) : undefined
  }
  const start = fromDatetimeLocal(form.start)
  return start ? timelineHref(start, fromDatetimeLocal(form.end)) : undefined
}

export const entryDay = (form: Pick<EntryForm, 'allDay' | 'date' | 'start'>): string =>
  form.allDay ? form.date : form.start.slice(0, 10)
