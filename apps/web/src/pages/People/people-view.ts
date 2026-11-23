import type { FollowingActor, ImportantDate, Person, PersonDateKind, PostMention } from '@aurboda/api-spec'

import { formatBirthDate, parseBirthDate } from '@aurboda/api-spec'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const monthName = (month: number): string => MONTHS[month - 1] ?? ''

const pad = (n: number) => String(n).padStart(2, '0')

/** A local Date as YYYY-MM-DD. */
export const localDateKey = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const dayNumber = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!) / 86_400_000
}

/** Whole days from `today` to `date` (both YYYY-MM-DD). */
export const daysUntil = (date: string, today: string): number => dayNumber(date) - dayNumber(today)

/** "today", "tomorrow", "in 12 days"; "yesterday" and "N days ago" for the past. */
export const relativeDay = (date: string, today: string): string => {
  const days = daysUntil(date, today)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}

/** "Tuesday 3 December". */
export const longDate = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]
  return `${weekday} ${d} ${monthName(m!)}`
}

/** "turns 40" for a birthday, "15 years" otherwise; empty without a count. */
export const yearsPhrase = (kind: PersonDateKind, years: number | undefined): string => {
  if (years === undefined) return ''
  if (kind === 'birthday') return `turns ${years}`
  return years === 1 ? '1 year' : `${years} years`
}

/** The parts of an upcoming date: "Tuesday 3 December · in 12 days · turns 40". */
export const importantDateDetail = (date: ImportantDate, today: string): string =>
  [longDate(date.date), relativeDay(date.date, today), yearsPhrase(date.kind, date.years)]
    .filter(Boolean)
    .join(' · ')

/** What the list and the Timeline call an upcoming date: a birthday's own label, else "Anna: Wedding anniversary". */
export const importantDateTitle = (date: ImportantDate): string =>
  date.date_id === null ? date.label : `${date.person.name}: ${date.label}`

/** Each person's first upcoming date, by person id. */
export const nextDateByPerson = (dates: readonly ImportantDate[]): Map<string, ImportantDate> => {
  const next = new Map<string, ImportantDate>()
  for (const date of [...dates].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!next.has(date.person.id)) next.set(date.person.id, date)
  }
  return next
}

export interface BirthdayForm {
  day: string
  month: string
  year: string
}

export const EMPTY_BIRTHDAY: BirthdayForm = { day: '', month: '', year: '' }

/** The form's fields from `YYYY-MM-DD` or `--MM-DD`. */
export const birthdayToForm = (birthDate: string | null | undefined): BirthdayForm => {
  const parsed = birthDate ? parseBirthDate(birthDate) : null
  if (!parsed) return EMPTY_BIRTHDAY
  return {
    day: String(parsed.day),
    month: String(parsed.month),
    year: parsed.year === null ? '' : String(parsed.year),
  }
}

/** The API value for the form: null when empty, `--MM-DD` without a year, or an error to show. */
export const formToBirthday = (form: BirthdayForm): { value: string | null } | { error: string } => {
  const day = form.day.trim()
  const month = form.month.trim()
  const year = form.year.trim()
  if (!day && !month && !year) return { value: null }
  if (!day || !month) return { error: 'Give both the day and the month, or neither.' }
  if (year && !/^\d{4}$/.test(year)) return { error: 'The year has four digits, like 1984.' }
  const value = formatBirthDate({ day: Number(day), month: Number(month), year: year ? Number(year) : null })
  return parseBirthDate(value) ? { value } : { error: 'That is not a real date.' }
}

/** "3 December", or "3 December 1984" with the year. */
export const birthdayLabel = (birthDate: string | null): string => {
  const parsed = birthDate ? parseBirthDate(birthDate) : null
  if (!parsed) return ''
  return `${parsed.day} ${monthName(parsed.month)}${parsed.year === null ? '' : ` ${parsed.year}`}`
}

const matches = (person: Pick<Person, 'name' | 'relationship' | 'actor'>, query: string): boolean => {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [person.name, person.relationship, person.actor?.handle].some((text) =>
    text?.toLowerCase().includes(q),
  )
}

/** The people whose name, relationship or handle contains the query. */
export const filterPeople = <T extends Pick<Person, 'name' | 'relationship' | 'actor'>>(
  people: readonly T[],
  query: string,
): T[] => people.filter((person) => matches(person, query))

/** A trimmed, non-empty name that no person (archived ones included) already has, ignoring case. */
export const newPersonName = (people: readonly Pick<Person, 'name'>[], typed: string): string | null => {
  const name = typed.trim()
  if (!name) return null
  const lower = name.toLowerCase()
  return people.some((p) => p.name.trim().toLowerCase() === lower) ? null : name
}

/** Followed accounts with a handle that no person has yet, so they can be added as one. */
export const followedWithoutProfile = (
  following: readonly FollowingActor[],
  people: readonly Pick<Person, 'actor'>[],
): FollowingActor[] => {
  const taken = new Set(people.flatMap((p) => (p.actor ? [p.actor.uri] : [])))
  return following.filter((f) => f.handle && !taken.has(f.actor_uri))
}

export interface WithPickerOptions {
  people: Person[]
  accounts: FollowingActor[]
}

/** What the With picker offers for a query: unchosen people, then followed accounts that have no profile yet. */
export const withPickerOptions = (
  people: readonly Person[],
  following: readonly FollowingActor[],
  chosen: readonly string[],
  query: string,
): WithPickerOptions => {
  const q = query.trim().toLowerCase()
  return {
    accounts: followedWithoutProfile(following, people).filter(
      (f) => !q || [f.handle, f.display_name].some((text) => text?.toLowerCase().includes(q)),
    ),
    people: filterPeople(
      people.filter((p) => !chosen.includes(p.id)),
      query,
    ),
  }
}

/** The name for a new person made from a followed account. */
export const nameForAccount = (account: Pick<FollowingActor, 'display_name' | 'handle'>): string =>
  account.display_name?.trim() || (account.handle ?? '').replace(/^@/, '').split('@')[0] || 'New person'

export interface MentionCandidate {
  id: string
  name: string
  handle: string
  actor_uri: string
}

/** The people an activity was with who have a fediverse handle: the only ones a share can mention. */
export const mentionCandidates = (
  activityPeople: readonly { id: string }[] | undefined,
  people: readonly Person[],
): MentionCandidate[] =>
  (activityPeople ?? []).flatMap(({ id }) => {
    const person = people.find((p) => p.id === id)
    const actor = person?.actor
    if (!person || !actor) return []
    return [{ actor_uri: actor.uri, handle: actor.handle ?? actor.uri, id: person.id, name: person.name }]
  })

/** A fresh share mentions nobody; an edit starts from whom the post already mentions. */
export const initialMentions = (
  candidates: readonly MentionCandidate[],
  postMentions: readonly PostMention[] | undefined,
  editing: boolean,
): string[] => {
  if (!editing) return []
  const uris = new Set((postMentions ?? []).map((m) => m.actor_uri))
  return candidates.filter((c) => uris.has(c.actor_uri)).map((c) => c.id)
}

/** The Analyze link for the time spent with one person. */
export const timeWithHref = (personId: string): string =>
  `/correlations?tab=explore&mode=continuous&trigger=people:${encodeURIComponent(personId)}`

export interface DateForm {
  label: string
  kind: PersonDateKind
  day: string
  month: string
  year: string
  notify: string
}

export const EMPTY_DATE_FORM: DateForm = {
  day: '',
  kind: 'anniversary',
  label: '',
  month: '',
  notify: '',
  year: '',
}

export const dateToForm = (date: {
  label: string
  kind: PersonDateKind
  day: number
  month: number
  year: number | null
  notify_days_before: number | null
}): DateForm => ({
  day: String(date.day),
  kind: date.kind,
  label: date.label,
  month: String(date.month),
  notify: date.notify_days_before === null ? '' : String(date.notify_days_before),
  year: date.year === null ? '' : String(date.year),
})

/** "remind me N days before" as the API wants it: null when empty, else 0 to 60. */
export const parseNotifyDays = (text: string): { value: number | null } | { error: string } => {
  const trimmed = text.trim()
  if (!trimmed) return { value: null }
  if (!/^\d+$/.test(trimmed) || Number(trimmed) > 60) {
    return { error: 'Remind me between 0 and 60 days before.' }
  }
  return { value: Number(trimmed) }
}

export interface DateBody {
  label: string
  kind: PersonDateKind
  day: number
  month: number
  year: number | null
  notify_days_before: number | null
}

/** The body for adding or saving a date, or an error to show. */
export const formToDateBody = (form: DateForm): { body: DateBody } | { error: string } => {
  const label = form.label.trim()
  if (!label) return { error: 'Give the date a name, like Wedding anniversary.' }
  const when = formToBirthday({ day: form.day, month: form.month, year: form.year })
  if ('error' in when) return when
  if (when.value === null) return { error: 'Give the day and the month.' }
  const notify = parseNotifyDays(form.notify)
  if ('error' in notify) return notify
  const parsed = parseBirthDate(when.value)!
  return {
    body: {
      day: parsed.day,
      kind: form.kind,
      label,
      month: parsed.month,
      notify_days_before: notify.value,
      year: parsed.year,
    },
  }
}

export const DATE_KIND_LABELS: Record<PersonDateKind, string> = {
  anniversary: 'Anniversary',
  birthday: 'Birthday',
  other: 'Other',
  remembrance: 'Remembrance',
}
