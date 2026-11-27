/**
 * Suggested links for journal entries: the people named in the text, the night's sleep of a morning
 * entry, and the activities of the entry's day. A suggestion is only that: nothing is linked until
 * the entry is saved with it in `related`, and the text is never changed.
 */

import {
  isFreeStandingNoteType,
  NOTE_LINK_SUGGESTIONS_PAGE_DEFAULT_LIMIT,
  NOTE_LINK_SUGGESTIONS_PAGE_MAX_LIMIT,
  NOTE_LINK_SUGGESTIONS_SAME_DAY_MAX,
  NOTES_SEARCH_DEFAULT_ENTITY_TYPES,
  type NoteLinkSuggestion,
  type NoteLinkSuggestionReason,
  type NoteLinkSuggestionsEntry,
  type NoteLinkSuggestionsPage,
  type NoteRelated,
  type NoteRelatedEntityType,
} from '@aurboda/api-spec'

import type { ActivityType } from '../schema.ts'

import {
  getActivityTypeDefinitions,
  getAllActivityTypeNames,
  getNoteById as dbGetNoteById,
  getNoteLinkDismissalsForNoteIds,
  getNoteLinksForNoteIds,
  insertNoteLinkDismissal,
  listPeople,
  type Note as DbNote,
  type NoteLinkDismissal,
  type NoteLinkRecord,
  searchNotes as dbSearchNotes,
} from '../db/index.ts'
import { UUID_RE } from '../utils.ts'
import {
  decodeNotesCursor,
  encodeNotesCursor,
  isCalendarDate,
  journalExcerpt,
  noteRelatedLabel,
} from './notes.ts'
import { queryActivities } from './queries/activities.ts'
import { getUserTimezone } from './settings.ts'

export interface SuggestionPerson {
  id: string
  name: string
}

/** An activity as a suggestion is made from: `name` is its title, else its type's display name, else its type. */
export interface SuggestionActivity {
  id: string
  activity_type: string
  name: string
  start_time: Date
  end_time: Date | null
  data?: Record<string, unknown>
}

export interface SuggestionEntry {
  entity_type: 'time' | 'day'
  start_time?: Date
  date?: string
}

export const suggestionKey = (entityType: NoteRelatedEntityType, entityId: string): string =>
  `${entityType}:${entityId.toLowerCase()}`

const LETTER_OR_DIGIT = String.raw`[\p{L}\p{N}]`
const POSSESSIVE = "(?:s|'s|’s)?"

const escapeRegExp = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

const wordsOf = (name: string): string[] => name.trim().split(/\s+/).filter(Boolean)

const wholeWordPattern = (words: readonly string[]): RegExp =>
  new RegExp(
    `(?<!${LETTER_OR_DIGIT})${words.map(escapeRegExp).join(String.raw`\s+`)}${POSSESSIVE}(?!${LETTER_OR_DIGIT})`,
    'iu',
  )

const FIRST_NAME_MIN_LENGTH = 3

/** Where the person is first named in `text`, by full name or (when it is theirs alone) first name; -1 when not. */
const firstMention = (
  text: string,
  person: SuggestionPerson,
  firstNameCounts: Map<string, number>,
): number => {
  const words = wordsOf(person.name)
  if (words.length === 0) return -1
  const found = [text.search(wholeWordPattern(words))]
  const first = words[0]!
  if (
    words.length > 1 &&
    [...first].length >= FIRST_NAME_MIN_LENGTH &&
    firstNameCounts.get(first.toLowerCase()) === 1
  ) {
    found.push(text.search(wholeWordPattern([first])))
  }
  const hits = found.filter((index) => index >= 0)
  return hits.length === 0 ? -1 : Math.min(...hits)
}

/**
 * The people named in `text` as whole words, case aside, also with a possessive s ("Saras",
 * "Sara's"). A first name alone counts when the name has more words, the first name is at least
 * three letters and no other of `people` shares it. The ones in `linked` or `dismissed` are left
 * out; the rest come in the order they are first named.
 */
export const suggestPeople = (
  text: string,
  people: readonly SuggestionPerson[],
  linked: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
): NoteLinkSuggestion[] => {
  const firstNameCounts = new Map<string, number>()
  for (const person of people) {
    const first = wordsOf(person.name)[0]?.toLowerCase()
    if (first !== undefined) firstNameCounts.set(first, (firstNameCounts.get(first) ?? 0) + 1)
  }
  return people
    .filter((person) => {
      const key = suggestionKey('person', person.id)
      return !linked.has(key) && !dismissed.has(key)
    })
    .map((person) => ({ index: firstMention(text, person, firstNameCounts), person }))
    .filter(({ index }) => index >= 0)
    .sort((a, b) => a.index - b.index)
    .map(({ person }) => ({
      entity_id: person.id,
      entity_type: 'person' as const,
      label: person.name,
      reason: 'name_in_text' as const,
    }))
}

const zoned = (instant: Date, tz: string) =>
  Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(tz)

const localDate = (instant: Date, tz: string): string => zoned(instant, tz).toPlainDate().toString()

/** The start of the local date `date` in `tz`. */
const startOfDay = (date: string, tz: string): Date =>
  new Date(Temporal.PlainDate.from(date).toZonedDateTime(tz).epochMilliseconds)

const NOON = 12

/** The entry's local date: a `day` entry's own, a `time` entry's start's in `tz`. */
export const entryLocalDate = (entry: SuggestionEntry, tz: string): string | undefined =>
  entry.entity_type === 'day'
    ? entry.date
    : entry.start_time === undefined
      ? undefined
      : localDate(entry.start_time, tz)

/** Location visits and screen-time spans are derived in the background: too many, and not what an entry is about. */
const isBackgroundActivity = (activity: SuggestionActivity): boolean =>
  activity.activity_type === 'location_visit' ||
  activity.activity_type === 'screentime' ||
  typeof activity.data?.category_path === 'string'

const activitySuggestion = (
  activity: SuggestionActivity,
  reason: NoteLinkSuggestionReason,
  tz: string,
): NoteLinkSuggestion => ({
  activity_type: activity.activity_type,
  entity_id: activity.id,
  entity_type: 'activity',
  label: noteRelatedLabel(
    {
      activity_type: activity.activity_type,
      end_time: activity.end_time,
      entity_type: 'activity',
      name: activity.name,
      start_time: activity.start_time,
    },
    tz,
  ),
  reason,
})

/**
 * The activities to suggest for an entry, in the user's zone `tz`: for a `time` entry before noon,
 * the sleep that ended on its date at or before it (the one ending last); then the activities other
 * than sleep starting on its date, in time order, at most {@link NOTE_LINK_SUGGESTIONS_SAME_DAY_MAX},
 * leaving out location visits and screen-time spans. The ones in `linked` or `dismissed` are left out.
 */
export const suggestActivities = (
  entry: SuggestionEntry,
  activities: readonly SuggestionActivity[],
  tz: string,
  linked: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
): NoteLinkSuggestion[] => {
  const date = entryLocalDate(entry, tz)
  if (date === undefined) return []
  const skipped = (activity: SuggestionActivity) => {
    const key = suggestionKey('activity', activity.id)
    return linked.has(key) || dismissed.has(key)
  }
  const out: NoteLinkSuggestion[] = []
  const start = entry.start_time
  if (entry.entity_type === 'time' && start !== undefined && zoned(start, tz).hour < NOON) {
    const sleep = activities
      .filter(
        (a): a is SuggestionActivity & { end_time: Date } =>
          a.activity_type === 'sleep' &&
          a.end_time !== null &&
          a.end_time.getTime() <= start.getTime() &&
          localDate(a.end_time, tz) === date,
      )
      .sort((a, b) => b.end_time.getTime() - a.end_time.getTime())[0]
    if (sleep && !skipped(sleep)) out.push(activitySuggestion(sleep, 'night_sleep', tz))
  }
  const seen = new Set<string>()
  const sameDay = activities
    .filter((a) => a.activity_type !== 'sleep' && !isBackgroundActivity(a) && !skipped(a))
    .filter((a) => localDate(a.start_time, tz) === date)
    .sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
    .filter((a) => {
      const key = a.id.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, NOTE_LINK_SUGGESTIONS_SAME_DAY_MAX)
  return [...out, ...sameDay.map((a) => activitySuggestion(a, 'same_day', tz))]
}

const keysOf = (list: readonly { entity_type: NoteRelatedEntityType; entity_id: string }[]): Set<string> =>
  new Set(list.map((item) => suggestionKey(item.entity_type, item.entity_id)))

const isJournalEntry = (note: DbNote): note is DbNote & { entity_type: 'time' | 'day' } =>
  isFreeStandingNoteType(note.entity_type)

const toSuggestionEntry = (note: DbNote & { entity_type: 'time' | 'day' }): SuggestionEntry => ({
  date: note.date,
  entity_type: note.entity_type,
  start_time: note.start_time,
})

const entryText = (note: DbNote): string => `${note.title ?? ''}\n${note.content}`

const toRelated = (link: NoteLinkRecord, tz: string): NoteRelated => ({
  ...(link.activity_type === null ? {} : { activity_type: link.activity_type }),
  ...(link.form_id === null ? {} : { form_id: link.form_id }),
  entity_id: link.entity_id,
  entity_type: link.entity_type,
  label: noteRelatedLabel(link, tz),
})

const DAY_MS = 24 * 60 * 60 * 1000

const plusDays = (date: string, days: number): string =>
  Temporal.PlainDate.from(date).add({ days }).toString()

const RUN_GAP_DAYS = 3

/**
 * The local dates as runs to read together: dates at most {@link RUN_GAP_DAYS} apart share one, so a
 * page of entries years apart reads a few short spans rather than everything between them.
 */
export const dateRuns = (dates: readonly string[]): { from: string; to: string }[] => {
  const sorted = [...new Set(dates)].sort()
  const runs: { from: string; to: string }[] = []
  for (const date of sorted) {
    const last = runs.at(-1)
    if (last && date <= plusDays(last.to, RUN_GAP_DAYS)) last.to = date
    else runs.push({ from: date, to: date })
  }
  return runs
}

/**
 * The live activities of the local dates in `dates` (in `tz`), and of the day before each (the
 * night's sleep starts then), through the same read as the activity list, so merges and rules apply.
 */
const loadActivities = async (
  user: string,
  dates: readonly string[],
  tz: string,
): Promise<SuggestionActivity[]> => {
  const runs = dateRuns(dates)
  if (runs.length === 0) return []
  const types = ((await getAllActivityTypeNames(user)) as ActivityType[]).filter(
    (t) => t !== 'location_visit',
  )
  if (types.length === 0) return []
  const [batches, definitions] = await Promise.all([
    Promise.all(
      runs.map(({ from, to }) =>
        queryActivities(
          user,
          types,
          new Date(startOfDay(from, tz).getTime() - DAY_MS),
          new Date(startOfDay(plusDays(to, 1), tz).getTime() - 1),
        ),
      ),
    ),
    getActivityTypeDefinitions(user),
  ])
  const displayNames = new Map(definitions.map((d) => [d.name, d.display_name]))
  return batches.flat().flatMap((a) => {
    const id = a.id?.replace(/^merged:/, '')
    if (id === undefined || !UUID_RE.test(id)) return []
    return [
      {
        activity_type: a.activity_type,
        data: a.data,
        end_time: a.end_time === undefined ? null : new Date(a.end_time),
        id,
        name: a.title || displayNames.get(a.activity_type) || a.activity_type,
        start_time: new Date(a.start_time),
      },
    ]
  })
}

const loadPeople = async (user: string): Promise<SuggestionPerson[]> =>
  (await listPeople(user)).map((p) => ({ id: p.id, name: p.name }))

const suggestionsFor = (
  note: DbNote & { entity_type: 'time' | 'day' },
  context: {
    people: readonly SuggestionPerson[]
    activities: readonly SuggestionActivity[]
    links: readonly NoteLinkRecord[]
    dismissals: readonly NoteLinkDismissal[]
    tz: string
  },
): NoteLinkSuggestion[] => {
  const linked = keysOf(context.links)
  const dismissed = keysOf(context.dismissals)
  return [
    ...suggestPeople(entryText(note), context.people, linked, dismissed),
    ...suggestActivities(toSuggestionEntry(note), context.activities, context.tz, linked, dismissed),
  ]
}

export type NoteLinkSuggestionsResult =
  | { success: true; data: NoteLinkSuggestion[] }
  | { success: false; error: string; errorCode: 'not_found' }

const NOTE_NOT_FOUND = 'Note not found'
const NOT_AN_ENTRY = 'Not a journal entry (a "time" or "day" note)'

/** The live journal entry `id`, or why there is none. */
const loadEntry = async (
  user: string,
  id: string,
): Promise<{ note: DbNote & { entity_type: 'time' | 'day' } } | { error: string }> => {
  if (!UUID_RE.test(id)) return { error: NOTE_NOT_FOUND }
  const note = await dbGetNoteById(user, id)
  if (!note) return { error: NOTE_NOT_FOUND }
  if (!isJournalEntry(note)) return { error: NOT_AN_ENTRY }
  return { note }
}

/** The links suggested for one journal entry. */
export async function getNoteLinkSuggestions(user: string, id: string): Promise<NoteLinkSuggestionsResult> {
  const found = await loadEntry(user, id)
  if ('error' in found) return { error: found.error, errorCode: 'not_found', success: false }
  const { note } = found
  const tz = await getUserTimezone(user)
  const date = entryLocalDate(toSuggestionEntry(note), tz)
  const [links, dismissals, people, activities] = await Promise.all([
    getNoteLinksForNoteIds(user, [note.id]),
    getNoteLinkDismissalsForNoteIds(user, [note.id]),
    loadPeople(user),
    loadActivities(user, date === undefined ? [] : [date], tz),
  ])
  return {
    data: suggestionsFor(note, {
      activities,
      dismissals: dismissals.get(note.id) ?? [],
      links: links.get(note.id) ?? [],
      people,
      tz,
    }),
    success: true,
  }
}

export type DismissNoteLinkSuggestionResult =
  | { success: true }
  | { success: false; error: string; errorCode: 'not_found' | 'invalid' }

/** Stop suggesting the person or activity for the journal entry `id`. */
export async function dismissNoteLinkSuggestion(
  user: string,
  id: string,
  input: NoteLinkDismissal,
): Promise<DismissNoteLinkSuggestionResult> {
  if (!UUID_RE.test(input.entity_id)) {
    return { error: `Not a UUID: ${input.entity_id}`, errorCode: 'invalid', success: false }
  }
  const found = await loadEntry(user, id)
  if ('error' in found) return { error: found.error, errorCode: 'not_found', success: false }
  await insertNoteLinkDismissal(user, found.note.id, input)
  return { success: true }
}

export interface NoteLinkSuggestionsPageInput {
  from?: string
  to?: string
  tz?: string
  unlinked_only?: boolean
  cursor?: string
  limit?: number
}

export type NoteLinkSuggestionsPageResult =
  | { success: true; data: NoteLinkSuggestionsPage }
  | { success: false; error: string; errorCode: 'invalid' }

const pageInvalid = (error: string): NoteLinkSuggestionsPageResult => ({
  error,
  errorCode: 'invalid',
  success: false,
})

const toPageEntry = (
  note: DbNote & { entity_type: 'time' | 'day' },
  related: NoteRelated[],
  suggestions: NoteLinkSuggestion[],
): NoteLinkSuggestionsEntry => ({
  date: note.entity_type === 'day' ? note.date : undefined,
  entity_type: note.entity_type,
  excerpt: journalExcerpt(note.content),
  id: note.id,
  related,
  start_time: note.entity_type === 'time' ? note.start_time?.toISOString() : undefined,
  suggestions,
  title: note.title || undefined,
  updated_at: note.updated_at.toISOString(),
})

/**
 * A page of journal entries, newest first, each with its suggestions; only those with one are
 * listed. With `unlinked_only` (the default) an entry already related to anything is left out.
 * The page is the search's page, so it may hold fewer entries than `limit` while there are more.
 * One zone, `tz` or else the user's, reads the date range, each entry's day and the labels.
 */
// eslint-disable-next-line complexity -- one check per query parameter
export async function listNoteLinkSuggestionsPage(
  user: string,
  input: NoteLinkSuggestionsPageInput,
): Promise<NoteLinkSuggestionsPageResult> {
  for (const date of [input.from, input.to]) {
    if (date !== undefined && !isCalendarDate(date)) return pageInvalid(`Not a date (YYYY-MM-DD): ${date}`)
  }
  if (input.from !== undefined && input.to !== undefined && input.from > input.to) {
    return pageInvalid('to must not precede from')
  }
  const cursor = input.cursor === undefined ? undefined : decodeNotesCursor(input.cursor)
  if (cursor === null) return pageInvalid('Not a valid cursor')
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? NOTE_LINK_SUGGESTIONS_PAGE_DEFAULT_LIMIT), 1),
    NOTE_LINK_SUGGESTIONS_PAGE_MAX_LIMIT,
  )
  const unlinkedOnly = input.unlinked_only !== false
  const tz = input.tz ?? (await getUserTimezone(user))

  const page = await dbSearchNotes(user, {
    cursor,
    entity_types: [...NOTES_SEARCH_DEFAULT_ENTITY_TYPES],
    from: input.from,
    limit,
    to: input.to,
    tz,
  })
  const nextCursor = page.next_cursor ? encodeNotesCursor(page.next_cursor) : undefined
  const entries = page.notes.filter(isJournalEntry)
  const ids = entries.map((n) => n.id)
  const links = await getNoteLinksForNoteIds(user, ids)
  const candidates = unlinkedOnly ? entries.filter((n) => (links.get(n.id) ?? []).length === 0) : entries
  if (candidates.length === 0) return { data: { entries: [], next_cursor: nextCursor }, success: true }

  const dates = candidates
    .map((n) => entryLocalDate(toSuggestionEntry(n), tz))
    .filter((d): d is string => d !== undefined)
  const [dismissals, people, activities] = await Promise.all([
    getNoteLinkDismissalsForNoteIds(
      user,
      candidates.map((n) => n.id),
    ),
    loadPeople(user),
    loadActivities(user, dates, tz),
  ])

  const listed = candidates.flatMap((note) => {
    const noteLinks = links.get(note.id) ?? []
    const suggestions = suggestionsFor(note, {
      activities,
      dismissals: dismissals.get(note.id) ?? [],
      links: noteLinks,
      people,
      tz,
    })
    if (suggestions.length === 0) return []
    return [
      toPageEntry(
        note,
        noteLinks.map((link) => toRelated(link, tz)),
        suggestions,
      ),
    ]
  })
  return { data: { entries: listed, next_cursor: nextCursor }, success: true }
}
