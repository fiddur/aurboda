import type {
  JournalEntryRef,
  NoteRelated,
  NoteRelatedEntityType,
  NoteRelatedInput,
  Person,
} from '@aurboda/api-spec'

import { addDays, format, parseISO } from 'date-fns'

import type { Activity } from '../../state/api/types'

import { toDisplayName } from '../../utils/displayName'
import { filterPeople } from '../People/people-view'

/** A link as the editor holds it: the target and the label its chip shows. */
export type RelatedLink = NoteRelated

const linkKey = (link: Pick<NoteRelated, 'entity_type' | 'entity_id'>) =>
  `${link.entity_type}:${link.entity_id.toLowerCase()}`

export const hasLink = (
  links: readonly RelatedLink[],
  link: Pick<NoteRelated, 'entity_type' | 'entity_id'>,
) => links.some((l) => linkKey(l) === linkKey(link))

/** `links` with `link` added at the end, unless it is already there. */
export const addLink = (links: readonly RelatedLink[], link: RelatedLink): RelatedLink[] =>
  hasLink(links, link) ? [...links] : [...links, link]

export const removeLink = (
  links: readonly RelatedLink[],
  link: Pick<NoteRelated, 'entity_type' | 'entity_id'>,
): RelatedLink[] => links.filter((l) => linkKey(l) !== linkKey(link))

export const sameLinks = (a: readonly RelatedLink[], b: readonly RelatedLink[]): boolean => {
  const keys = new Set(a.map(linkKey))
  return keys.size === new Set(b.map(linkKey)).size && b.every((l) => keys.has(linkKey(l)))
}

/** Every link of either list, `first`'s first. */
export const unionLinks = (first: readonly RelatedLink[], second: readonly RelatedLink[]): RelatedLink[] =>
  second.reduce((all, link) => addLink(all, link), [...first])

export const linksToInput = (links: readonly RelatedLink[]): NoteRelatedInput[] =>
  links.map(({ entity_id, entity_type }) => ({ entity_id, entity_type }))

export const relatedHref = (link: Pick<NoteRelated, 'entity_type' | 'entity_id'>): string =>
  link.entity_type === 'person'
    ? `/people/${encodeURIComponent(link.entity_id)}`
    : `/detail/activity/${encodeURIComponent(link.entity_id)}`

export const isRelatedLink = (value: unknown): value is RelatedLink => {
  if (typeof value !== 'object' || value === null) return false
  const link = value as Record<string, unknown>
  return (
    (link.entity_type === 'person' || link.entity_type === 'activity') &&
    typeof link.entity_id === 'string' &&
    typeof link.label === 'string'
  )
}

export const personLink = (person: Pick<Person, 'id' | 'name'>): RelatedLink => ({
  entity_id: person.id,
  entity_type: 'person',
  label: person.name,
})

/** The activity's row id, without the `merged:` prefix a list answer may give it. */
export const activityRowId = (activity: Pick<Activity, 'id'>): string =>
  (activity.id ?? '').replace(/^merged:/, '')

/** Its title, else its type's name, and its local date: as the server labels it. */
export const activityLabel = (
  activity: Pick<Activity, 'title' | 'activity_type' | 'start_time'>,
  typeName: (type: string) => string = toDisplayName,
): string =>
  `${activity.title?.trim() || typeName(activity.activity_type)}, ${format(activity.start_time, 'yyyy-MM-dd')}`

export const activityLink = (
  activity: Pick<Activity, 'id' | 'title' | 'activity_type' | 'start_time'>,
  typeName?: (type: string) => string,
): RelatedLink => ({
  entity_id: activityRowId(activity),
  entity_type: 'activity',
  label: activityLabel(activity, typeName),
})

/** What to fetch for a day's picker: from noon the day before (last night's sleep) to the day's end. */
export const dayActivityWindow = (date: string): { start: Date; end: Date } => {
  const day = parseISO(date)
  const start = addDays(day, -1)
  start.setHours(12, 0, 0, 0)
  return { end: addDays(day, 1), start }
}

const isSleep = (activity: Pick<Activity, 'activity_type'>) => activity.activity_type === 'sleep'

/**
 * The activities of `date` for the picker: the sleep that ended that morning first, then those
 * starting that day in time order. Optionally only those whose type or title holds `typeFilter`.
 */
export const dayActivityOptions = <
  T extends Pick<Activity, 'id' | 'activity_type' | 'title' | 'start_time' | 'end_time'>,
>(
  activities: readonly T[],
  date: string,
  typeFilter = '',
  typeName: (type: string) => string = toDisplayName,
): T[] => {
  const dayOf = (instant: Date) => format(instant, 'yyyy-MM-dd')
  const sleeps = activities.filter(
    (a) =>
      isSleep(a) && a.end_time !== undefined && dayOf(a.end_time) === date && dayOf(a.start_time) !== date,
  )
  const ofDay = activities
    .filter((a) => dayOf(a.start_time) === date)
    .sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
  const seen = new Set<string>()
  const q = typeFilter.trim().toLowerCase()
  return [...sleeps, ...ofDay].filter((a) => {
    const id = activityRowId(a)
    if (seen.has(id)) return false
    seen.add(id)
    if (!q) return true
    return [a.activity_type, typeName(a.activity_type), a.title ?? ''].some((text) =>
      text.toLowerCase().includes(q),
    )
  })
}

export const MENTION_MAX_QUERY = 30

/** The `@` being typed at `cursor`: where it starts and what follows it, or null when there is none. */
export const mentionAt = (text: string, cursor: number): { start: number; query: string } | null => {
  const before = text.slice(0, cursor)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/[\s([{"'“]/.test(before[at - 1]!)) return null
  const query = before.slice(at + 1)
  if (query.length > MENTION_MAX_QUERY || /[\n@]/.test(query) || /^\s/.test(query)) return null
  return { query, start: at }
}

/** The text with the `@query` from `start` to `cursor` replaced by `name`, and where the cursor goes. */
export const insertMention = (
  text: string,
  start: number,
  cursor: number,
  name: string,
): { text: string; cursor: number } => {
  const after = text.slice(cursor)
  const spacer = after.startsWith(' ') || after.startsWith('\n') ? '' : ' '
  const inserted = `${name}${spacer}`
  return { cursor: start + inserted.length, text: `${text.slice(0, start)}${inserted}${after}` }
}

export const MENTION_MAX_OPTIONS = 8

/** The people whose name (or relationship or handle) holds the query, names starting with it first, a handful. */
export const mentionOptions = <T extends Pick<Person, 'id' | 'name' | 'relationship' | 'actor'>>(
  people: readonly T[],
  query: string,
): T[] => {
  const q = query.trim().toLowerCase()
  const found = filterPeople(people, q)
  const starts = found.filter((p) => p.name.toLowerCase().startsWith(q))
  const rest = found.filter((p) => !p.name.toLowerCase().startsWith(q))
  return [...starts, ...rest].slice(0, MENTION_MAX_OPTIONS)
}

/** The arrow-keyed choice, wrapping around. */
export const moveChoice = (index: number, step: 1 | -1, count: number): number =>
  count === 0 ? 0 : (index + step + count) % count

/** The journal's "Related to" filter as `/journal?person=<id>` or `?activity=<id>` gives it. */
export interface RelatedFilter {
  type: NoteRelatedEntityType
  id: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const relatedFilterFromQuery = (
  query: Record<string, string | undefined>,
): RelatedFilter | undefined => {
  if (query.person && UUID.test(query.person)) return { id: query.person, type: 'person' }
  if (query.activity && UUID.test(query.activity.replace(/^merged:/, ''))) {
    return { id: query.activity.replace(/^merged:/, ''), type: 'activity' }
  }
  return undefined
}

export const relatedFilterHref = (filter: RelatedFilter): string =>
  `/journal?${filter.type}=${encodeURIComponent(filter.id)}`

/** A related entry's heading: its title, else its date ("Fri 20 Nov 2026"). */
export const journalRefHeading = (ref: Pick<JournalEntryRef, 'title' | 'date' | 'start_time'>): string => {
  if (ref.title?.trim()) return ref.title.trim()
  if (ref.date) return format(parseISO(ref.date), 'EEE d MMM yyyy')
  if (ref.start_time) return format(new Date(ref.start_time), 'EEE d MMM yyyy, HH:mm')
  return 'Entry'
}

/** The date under a titled entry; none when the heading already is the date. */
export const journalRefWhen = (ref: Pick<JournalEntryRef, 'title' | 'date' | 'start_time'>): string => {
  if (!ref.title?.trim()) return ''
  if (ref.date) return format(parseISO(ref.date), 'EEE d MMM yyyy')
  if (ref.start_time) return format(new Date(ref.start_time), 'EEE d MMM yyyy, HH:mm')
  return ''
}

/** A journal entry opens in the editor; a comment on something else has no page of its own here. */
export const journalRefHref = (ref: Pick<JournalEntryRef, 'id' | 'entity_type'>): string | undefined =>
  ref.entity_type === 'time' || ref.entity_type === 'day'
    ? `/journal/${encodeURIComponent(ref.id)}`
    : undefined
