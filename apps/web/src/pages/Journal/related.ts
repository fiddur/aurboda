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
import { filterPeople, newPersonName } from '../People/people-view'

/** A link as the editor holds it: the target and the label its chip shows. */
export type RelatedLink = NoteRelated

export const linkKey = (link: Pick<NoteRelated, 'entity_type' | 'entity_id'>) =>
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

const isSleep = (activity: Pick<Activity, 'activity_type'>) => activity.activity_type === 'sleep'

/** The people offered for a new link: an archived person keeps the links they have, but gets no new ones. */
export const offeredPeople = <T extends Pick<Person, 'archived'>>(people: readonly T[]): T[] =>
  people.filter((p) => !p.archived)

/**
 * The keys of the links in `links` that a save refused as no longer there: the ids an
 * `Unknown person: <ids>` or `Unknown activity: <ids>` answer names.
 */
export const refusedLinkKeys = (message: string, links: readonly RelatedLink[]): Set<string> => {
  const match = /^Unknown (person|activity): (.+)$/.exec(message.trim())
  if (!match) return new Set()
  const named = new Set(
    match[2]!
      .split(',')
      .map((id) => linkKey({ entity_id: id.trim(), entity_type: match[1] as NoteRelatedEntityType })),
  )
  return new Set(links.map(linkKey).filter((key) => named.has(key)))
}

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

/** Its title, else its type's name, and its local date (a sleep's, the morning it ended): as the server labels it. */
export const activityLabel = (
  activity: Pick<Activity, 'title' | 'activity_type' | 'start_time' | 'end_time'>,
  typeName: (type: string) => string = toDisplayName,
): string => {
  const dated = isSleep(activity) && activity.end_time ? activity.end_time : activity.start_time
  return `${activity.title?.trim() || typeName(activity.activity_type)}, ${format(dated, 'yyyy-MM-dd')}`
}

export const activityLink = (
  activity: Pick<Activity, 'id' | 'title' | 'activity_type' | 'start_time' | 'end_time'>,
  typeName?: (type: string) => string,
): RelatedLink => ({
  activity_type: activity.activity_type,
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

export const MENTION_MAX_OPTIONS = 50

/** The people whose name (or relationship or handle) holds the query, names starting with it first. */
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

export type MentionItem<T> = { kind: 'person'; person: T } | { kind: 'new'; name: string }

/** The `@` menu: the matching people, then "add as a person" when the query names nobody yet. */
export const mentionItems = <T extends Pick<Person, 'id' | 'name' | 'relationship' | 'actor'>>(
  offered: readonly T[],
  all: readonly Pick<Person, 'name'>[],
  query: string,
): MentionItem<T>[] => {
  const people = mentionOptions(offered, query).map((person): MentionItem<T> => ({ kind: 'person', person }))
  const name = newPersonName(all, query)
  return name === null ? people : [...people, { kind: 'new', name }]
}

/**
 * Whether Enter or Tab takes the item: a person always, "add as a person" only once the user has
 * arrowed to it, since the query runs on across spaces and Enter there usually means a new line.
 */
export const keyPicks = (item: MentionItem<unknown>, navigated: boolean): boolean =>
  item.kind === 'person' || navigated

/** The index the menu shows as chosen: none while the default would be "add as a person". */
export const highlighted = (
  items: readonly MentionItem<unknown>[],
  choice: number,
  navigated: boolean,
): number => (navigated || items[Math.min(choice, items.length - 1)]?.kind !== 'new' ? choice : -1)

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

/** What the "Related to" button shows: Anyone, the person's name, or the activity's label once loaded. */
export const relatedFilterLabel = (
  filter: RelatedFilter | undefined,
  people: readonly Pick<Person, 'id' | 'name'>[],
  activity: string | undefined,
): string => {
  if (!filter) return 'Anyone'
  if (filter.type === 'activity') return activity ?? 'This activity'
  return people.find((person) => person.id === filter.id)?.name ?? 'Someone'
}

/** The filter as the single link the picker leaves out of its options. */
export const relatedFilterLinks = (filter: RelatedFilter | undefined, label: string): RelatedLink[] =>
  filter ? [{ entity_id: filter.id, entity_type: filter.type, label }] : []

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
