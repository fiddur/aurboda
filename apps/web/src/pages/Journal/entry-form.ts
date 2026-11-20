import type { AddNoteBody, Note, UpdateNoteBody } from '@aurboda/api-spec'

import { extractHashtags, normalizeTag } from '@aurboda/api-spec'
import { format } from 'date-fns'

import { fromDatetimeLocal, toDatetimeLocal } from '../../components/CommentThread/datetimeLocal'

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
}

export const emptyEntryForm = (now: Date = new Date(), content = ''): EntryForm => ({
  allDay: false,
  content,
  date: format(now, 'yyyy-MM-dd'),
  end: '',
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
  tags: form.tags,
  title: form.title.trim() || null,
  ...anchorFields(form),
})

export const formToUpdateBody = (form: EntryForm, expectedUpdatedAt: string | undefined): UpdateNoteBody => ({
  content: form.content,
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

/** Two forms say the same thing to the server. */
export const sameEntry = (a: EntryForm, b: EntryForm): boolean =>
  a.title.trim() === b.title.trim() &&
  a.content === b.content &&
  a.tags.join(',') === b.tags.join(',') &&
  a.allDay === b.allDay &&
  (a.allDay ? a.date === b.date : a.start === b.start && a.end === b.end)
