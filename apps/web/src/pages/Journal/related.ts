import type {
  CheckIn,
  JournalEntryRef,
  NoteRelated,
  NoteRelatedEntityType,
  NoteRelatedInput,
  Person,
} from '@aurboda/api-spec'

import { noteRelatedEntityTypes } from '@aurboda/api-spec'
import { addDays, format, parseISO } from 'date-fns'

import type { Activity, Meal, Report } from '../../state/api/types'

import { toDisplayName } from '../../utils/displayName'
import { filterPeople, newPersonName } from '../People/people-view'

/** A link as the editor holds it: the target and the label its chip shows. */
export type RelatedLink = NoteRelated

/** What each kind of target is called in a sentence ("This meal was removed"), as the server names it in a refusal. */
export const relatedNoun: Record<NoteRelatedEntityType, string> = {
  activity: 'activity',
  check_in: 'check-in',
  meal: 'meal',
  person: 'person',
  report: 'report',
}

export const isRelatedType = (value: unknown): value is NoteRelatedEntityType =>
  (noteRelatedEntityTypes as readonly unknown[]).includes(value)

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
 * `Unknown <kind>: <ids>` answer names (`Unknown person`, `Unknown check-in`, …).
 */
export const refusedLinkKeys = (message: string, links: readonly RelatedLink[]): Set<string> => {
  const match = /^Unknown ([a-z-]+): (.+)$/.exec(message.trim())
  if (!match) return new Set()
  const type = noteRelatedEntityTypes.find((kind) => relatedNoun[kind] === match[1])
  if (!type) return new Set()
  const named = new Set(
    match[2]!.split(',').map((id) => linkKey({ entity_id: id.trim(), entity_type: type })),
  )
  return new Set(links.map(linkKey).filter((key) => named.has(key)))
}

export const relatedHref = (link: Pick<NoteRelated, 'entity_type' | 'entity_id' | 'form_id'>): string => {
  const id = encodeURIComponent(link.entity_id)
  switch (link.entity_type) {
    case 'person':
      return `/people/${id}`
    case 'meal':
      return `/meals/${id}`
    case 'report':
      return `/reports/${id}`
    case 'check_in':
      return link.form_id ? `/check-ins/${encodeURIComponent(link.form_id)}` : '/check-ins'
    default:
      return `/detail/activity/${id}`
  }
}

export const isRelatedLink = (value: unknown): value is RelatedLink => {
  if (typeof value !== 'object' || value === null) return false
  const link = value as Record<string, unknown>
  return (
    isRelatedType(link.entity_type) && typeof link.entity_id === 'string' && typeof link.label === 'string'
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

const zonedParts = (instant: Date, tz: string, options: Intl.DateTimeFormatOptions): string | undefined => {
  try {
    return new Intl.DateTimeFormat('sv-SE', { ...options, timeZone: tz }).format(instant)
  } catch {
    return undefined
  }
}

/** YYYY-MM-DD in the zone `tz` (the user's configured one, as the server labels in), else the browser's. */
export const zonedDate = (instant: Date, tz?: string): string =>
  (tz && zonedParts(instant, tz, { day: '2-digit', month: '2-digit', year: 'numeric' })) ||
  format(instant, 'yyyy-MM-dd')

/** HH:mm in the zone `tz`, else the browser's. */
export const zonedTime = (instant: Date, tz?: string): string =>
  (tz && zonedParts(instant, tz, { hour: '2-digit', hourCycle: 'h23', minute: '2-digit' })) ||
  format(instant, 'HH:mm')

/** Its title, else its type's name, and its local date (a sleep's, the morning it ended): as the server labels it. */
export const activityLabel = (
  activity: Pick<Activity, 'title' | 'activity_type' | 'start_time' | 'end_time'>,
  typeName: (type: string) => string = toDisplayName,
  tz?: string,
): string => {
  const dated = isSleep(activity) && activity.end_time ? activity.end_time : activity.start_time
  return `${activity.title?.trim() || typeName(activity.activity_type)}, ${zonedDate(dated, tz)}`
}

export const activityLink = (
  activity: Pick<Activity, 'id' | 'title' | 'activity_type' | 'start_time' | 'end_time'>,
  typeName?: (type: string) => string,
  tz?: string,
): RelatedLink => ({
  activity_type: activity.activity_type,
  entity_id: activityRowId(activity),
  entity_type: 'activity',
  label: activityLabel(activity, typeName, tz),
})

/** A meal's type with a capital, as the meals page writes it, or "Meal" when it has none. */
const mealTypeName = (type: string | undefined): string => {
  const trimmed = type?.trim() ?? ''
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : 'Meal'
}

/** "Lunch 12:30": its type and local time, as the server labels it. */
export const mealLabel = (meal: Pick<Meal, 'meal_type' | 'time'>, tz?: string): string =>
  `${mealTypeName(meal.meal_type)} ${zonedTime(meal.time, tz)}`

export const mealLink = (meal: Pick<Meal, 'id' | 'meal_type' | 'time'>, tz?: string): RelatedLink => ({
  entity_id: meal.id ?? '',
  entity_type: 'meal',
  label: mealLabel(meal, tz),
})

export const reportTypeName = (type: string): string =>
  type.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())

/** "Blood Panel, 2026-11-20": its type and local date, as the server labels it. */
export const reportLabel = (report: Pick<Report, 'report_type' | 'date'>, tz?: string): string =>
  `${reportTypeName(report.report_type)}, ${zonedDate(report.date, tz)}`

export const reportLink = (
  report: Pick<Report, 'id' | 'report_type' | 'date'>,
  tz?: string,
): RelatedLink => ({
  entity_id: report.id ?? '',
  entity_type: 'report',
  label: reportLabel(report, tz),
})

/** "Morning 07:45": its form's name and the local time it was answered, as the server labels it. */
export const checkInLabel = (checkIn: Pick<CheckIn, 'form_name' | 'answered_at'>, tz?: string): string =>
  `${checkIn.form_name} ${zonedTime(new Date(checkIn.answered_at), tz)}`

export const checkInLink = (
  checkIn: Pick<CheckIn, 'id' | 'form_id' | 'form_name' | 'answered_at'>,
  tz?: string,
): RelatedLink => ({
  entity_id: checkIn.id,
  entity_type: 'check_in',
  form_id: checkIn.form_id,
  label: checkInLabel(checkIn, tz),
})

/** The local day `date` (YYYY-MM-DD), from its start to the next day's. */
export const dayWindow = (date: string): { start: Date; end: Date } => {
  const start = parseISO(date)
  return { end: addDays(start, 1), start }
}

const dayOf = (instant: Date) => format(instant, 'yyyy-MM-dd')

/** The meals eaten on `date`, in time order. */
export const dayMealOptions = <T extends Pick<Meal, 'time'>>(meals: readonly T[], date: string): T[] =>
  meals.filter((m) => dayOf(m.time) === date).sort((a, b) => a.time.getTime() - b.time.getTime())

/** The check-ins answered on `date` (a skip is not one), in time order. */
export const dayCheckInOptions = <T extends Pick<CheckIn, 'answered_at' | 'status'>>(
  checkIns: readonly T[],
  date: string,
): T[] =>
  checkIns
    .filter((c) => c.status !== 'skipped' && dayOf(new Date(c.answered_at)) === date)
    .sort((a, b) => new Date(a.answered_at).getTime() - new Date(b.answered_at).getTime())

export const REPORT_OPTIONS_MAX = 50

/** The reports to pick from, newest first, optionally only those whose type holds `typeFilter`. */
export const reportOptions = <T extends Pick<Report, 'report_type' | 'date'>>(
  reports: readonly T[],
  typeFilter = '',
): T[] => {
  const q = typeFilter.trim().toLowerCase()
  return reports
    .filter(
      (r) =>
        !q ||
        r.report_type.toLowerCase().includes(q) ||
        reportTypeName(r.report_type).toLowerCase().includes(q),
    )
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, REPORT_OPTIONS_MAX)
}

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

/** The journal's "Related to" filter as `/journal?person=<id>`, `?activity=<id>`, `?meal=<id>` and so on give it. */
export interface RelatedFilter {
  type: NoteRelatedEntityType
  id: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const relatedFilterFromQuery = (
  query: Record<string, string | undefined>,
): RelatedFilter | undefined => {
  for (const type of noteRelatedEntityTypes) {
    const id = query[type]?.replace(/^merged:/, '')
    if (id && UUID.test(id)) return { id, type }
  }
  return undefined
}

export const relatedFilterHref = (filter: RelatedFilter): string =>
  `/journal?${filter.type}=${encodeURIComponent(filter.id)}`

/** What the "Related to" button shows: Anyone, the person's name, or the target's label once loaded. */
export const relatedFilterLabel = (
  filter: RelatedFilter | undefined,
  people: readonly Pick<Person, 'id' | 'name'>[],
  target: string | undefined,
): string => {
  if (!filter) return 'Anyone'
  if (filter.type !== 'person') return target ?? `This ${relatedNoun[filter.type]}`
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
