import type { AddReminderBody, Reminder, UpdateReminderBody } from '@aurboda/api-spec'

import { NAV_LINKS_PRIMARY, NAV_LINKS_SECONDARY, SHARING_LINKS } from '../../components/nav-links'

export const WEEKDAYS = [
  { day: 1, short: 'Mon' },
  { day: 2, short: 'Tue' },
  { day: 3, short: 'Wed' },
  { day: 4, short: 'Thu' },
  { day: 5, short: 'Fri' },
  { day: 6, short: 'Sat' },
  { day: 7, short: 'Sun' },
] as const

export const ALL_DAYS = WEEKDAYS.map((w) => w.day)

const STEP_MINUTES = 5
const MINUTES_PER_DAY = 24 * 60
export const LINK_MAX = 500

export const NO_PAGE = ''
export const OTHER_PAGE = 'other'

export interface PageOption {
  href: string
  label: string
}

export const PAGE_OPTIONS: PageOption[] = [
  ...NAV_LINKS_PRIMARY,
  ...SHARING_LINKS,
  ...NAV_LINKS_SECONDARY,
].map((link) => ({ href: link.href, label: link.label.replace(/^\+\s*/, '') }))

const sameDays = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((day, i) => day === b[i])

/** "Every day at 20:00", "Weekdays at 07:30", "Mon, Wed, Fri at 07:30". */
export const scheduleLine = (timeOfDay: string, weekdays: readonly number[]): string => {
  const days = [...new Set(weekdays)].sort((a, b) => a - b)
  const when = sameDays(days, ALL_DAYS)
    ? 'Every day'
    : sameDays(days, [1, 2, 3, 4, 5])
      ? 'Weekdays'
      : sameDays(days, [6, 7])
        ? 'Weekends'
        : days.map((day) => WEEKDAYS[day - 1]?.short ?? String(day)).join(', ')
  return `${when} at ${timeOfDay}`
}

/** Rounds HH:MM to the nearest five minutes (23:58 becomes 00:00). Null when it is not a time. */
export const roundTime = (value: string): string | null => {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  const rounded = (Math.round((hours * 60 + minutes) / STEP_MINUTES) * STEP_MINUTES) % MINUTES_PER_DAY
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(rounded / 60))}:${pad(rounded % 60)}`
}

export const isInAppPath = (value: string): boolean => value.startsWith('/') && !value.startsWith('//')

export interface ReminderForm {
  title: string
  body: string
  time: string
  weekdays: number[]
  /** `NO_PAGE`, a page href, or `OTHER_PAGE`. */
  page: string
  otherPath: string
}

export const emptyForm = (): ReminderForm => ({
  body: '',
  otherPath: '',
  page: NO_PAGE,
  time: '20:00',
  title: '',
  weekdays: [...ALL_DAYS],
})

export const formFromReminder = (reminder: Reminder): ReminderForm => {
  const known = reminder.link !== null && PAGE_OPTIONS.some((option) => option.href === reminder.link)
  return {
    body: reminder.body ?? '',
    otherPath: reminder.link !== null && !known ? reminder.link : '',
    page: reminder.link === null ? NO_PAGE : known ? reminder.link : OTHER_PAGE,
    time: reminder.time_of_day,
    title: reminder.title,
    weekdays: [...reminder.weekdays],
  }
}

export const toggleDay = (weekdays: readonly number[], day: number): number[] =>
  weekdays.includes(day) ? weekdays.filter((d) => d !== day) : [...weekdays, day].sort((a, b) => a - b)

/** The first problem with the form in plain words, or null when it can be saved. */
export const formError = (form: ReminderForm): string | null => {
  if (form.title.trim() === '') return 'Give the reminder a name.'
  if (roundTime(form.time) === null) return 'Pick a time.'
  if (form.weekdays.length === 0) return 'Pick at least one day.'
  if (form.page === OTHER_PAGE) {
    const path = form.otherPath.trim()
    if (!isInAppPath(path)) return 'The page to open must be a path in Aurboda, starting with /.'
    if (path.length > LINK_MAX) return 'That path is too long.'
  }
  return null
}

const formLink = (form: ReminderForm): string | null =>
  form.page === NO_PAGE ? null : form.page === OTHER_PAGE ? form.otherPath.trim() : form.page

/** The PATCH body for an edit: every field, with null clearing text and link. */
export const formToUpdateBody = (form: ReminderForm): UpdateReminderBody => ({
  body: form.body.trim() === '' ? null : form.body.trim(),
  link: formLink(form),
  time_of_day: roundTime(form.time) ?? form.time,
  title: form.title.trim(),
  weekdays: [...new Set(form.weekdays)].sort((a, b) => a - b),
})

export const formToAddBody = (form: ReminderForm): AddReminderBody => {
  const { body, link, time_of_day, title, weekdays } = formToUpdateBody(form)
  return {
    body: body ?? undefined,
    enabled: true,
    link: link ?? undefined,
    time_of_day: time_of_day!,
    title: title!,
    weekdays: weekdays!,
  }
}

export const pageLabel = (link: string): string =>
  PAGE_OPTIONS.find((option) => option.href === link)?.label ?? link
