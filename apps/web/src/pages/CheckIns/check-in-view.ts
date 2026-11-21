import type {
  CheckIn,
  CheckInAnswerValue,
  CheckInForm,
  CheckInQuestion,
  DueSlot,
  Schedule,
} from '@aurboda/api-spec'

import { format, isSameDay, subDays } from 'date-fns'

import { scheduleLine } from '../Reminders/reminder-form'

/** "Every day at 08:00 and 21:00", "Weekdays at 07:30, from Dec 1, 2026 to Jan 31, 2027". */
export const checkInScheduleLine = (schedule: Schedule, locale?: string): string => {
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
  const day = (date: string) => dates.format(new Date(`${date}T00:00:00Z`))
  const base = scheduleLine(schedule.times, schedule.weekdays)
  if (schedule.start_date && schedule.end_date) {
    return `${base}, from ${day(schedule.start_date)} to ${day(schedule.end_date)}`
  }
  if (schedule.start_date) return `${base}, from ${day(schedule.start_date)}`
  if (schedule.end_date) return `${base}, until ${day(schedule.end_date)}`
  return base
}

/** "Due now", "Later today at 21:00", "Done", "Skipped", "Missed". */
export const slotLabel = (slot: Pick<DueSlot, 'state' | 'time'>): string => {
  switch (slot.state) {
    case 'due':
      return 'Due now'
    case 'upcoming':
      return `Later today at ${slot.time}`
    case 'done':
      return 'Done'
    case 'skipped':
      return 'Skipped'
    case 'missed':
      return 'Missed'
  }
}

/** The link that fills in a form, for a slot when one is given. */
export const fillHref = (formId: string, scheduledFor?: string): string =>
  `/check-ins/${encodeURIComponent(formId)}${scheduledFor ? `?slot=${encodeURIComponent(scheduledFor)}` : ''}`

/** The link that fills in a form tied to an activity. */
export const activityFillHref = (formId: string, activityId: string): string =>
  `/check-ins/${encodeURIComponent(formId)}?activity=${encodeURIComponent(activityId)}`

/** "today 08:12", "yesterday 21:03", "3 Nov 08:12", "3 Nov 2025 08:12". */
export const whenLine = (at: Date, now: Date): string => {
  const time = format(at, 'HH:mm')
  if (isSameDay(at, now)) return `today ${time}`
  if (isSameDay(at, subDays(now, 1))) return `yesterday ${time}`
  return at.getFullYear() === now.getFullYear()
    ? format(at, `d MMM '${time}'`)
    : format(at, `d MMM yyyy '${time}'`)
}

export const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)

/** "Answered today 08:12", with ", score 14" when the check-in has one. */
export const answeredLine = (checkIn: Pick<CheckIn, 'answered_at' | 'score'>, now: Date): string => {
  const when = `Answered ${whenLine(new Date(checkIn.answered_at), now)}`
  return checkIn.score === null ? when : `${when}, score ${formatNumber(checkIn.score)}`
}

/** The newest check-in of each form, from a newest-first list. */
export const latestByForm = (checkIns: readonly CheckIn[]): Map<string, CheckIn> => {
  const latest = new Map<string, CheckIn>()
  for (const checkIn of checkIns) if (!latest.has(checkIn.form_id)) latest.set(checkIn.form_id, checkIn)
  return latest
}

const NONE = '—'

const optionLabel = (question: Extract<CheckInQuestion, { options: unknown }>, key: string): string =>
  question.options.find((option) => option.key === key)?.label ?? key

const numberText = (question: Extract<CheckInQuestion, { type: 'number' }>, value: number): string =>
  `${formatNumber(value)}${question.unit ? ` ${question.unit}` : ''}`

const multiText = (
  question: Extract<CheckInQuestion, { type: 'multi_choice' }>,
  value: CheckInAnswerValue,
): string | null =>
  Array.isArray(value) && value.length > 0 ? value.map((key) => optionLabel(question, key)).join(', ') : null

const typedAnswer = (question: CheckInQuestion, value: CheckInAnswerValue): string | null => {
  switch (question.type) {
    case 'number':
      return typeof value === 'number' ? numberText(question, value) : null
    case 'scale':
      return typeof value === 'number' ? `${value} of ${question.min}–${question.max}` : null
    case 'yes_no':
      return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : null
    case 'choice':
      return typeof value === 'string' ? optionLabel(question, value) : null
    case 'multi_choice':
      return multiText(question, value)
    case 'text':
      return typeof value === 'string' && value.trim() !== '' ? value : null
  }
}

/** An answer in words, read against the question it answered. */
export const formatAnswer = (question: CheckInQuestion, value: CheckInAnswerValue | undefined): string =>
  value === undefined ? NONE : (typedAnswer(question, value) ?? NONE)

/** Mirrors the server: the value itself, yes as 1 and no as 0, or the chosen option's value. */
export const numericAnswer = (
  question: CheckInQuestion,
  value: CheckInAnswerValue | undefined,
): number | undefined => {
  if (value === undefined) return undefined
  switch (question.type) {
    case 'number':
    case 'scale':
      return typeof value === 'number' ? value : undefined
    case 'yes_no':
      return typeof value === 'boolean' ? (value ? 1 : 0) : undefined
    case 'choice':
      return question.options.find((option) => option.key === value)?.value
    default:
      return undefined
  }
}

export interface CheckInSeries {
  /** What is charted, in words. */
  label: string
  metric: string
  /** Oldest first. */
  points: { date: string; value: number }[]
}

/**
 * What the form's history charts: its score when it has one, else its first question logged to a
 * metric. Each check-in is read against the questions it answered. Null when there is neither.
 */
export const checkInSeries = (form: CheckInForm, checkIns: readonly CheckIn[]): CheckInSeries | null => {
  const oldestFirst = [...checkIns].sort((a, b) => a.answered_at.localeCompare(b.answered_at))
  if (form.score) {
    return {
      label: 'Score',
      metric: form.score.metric,
      points: oldestFirst.flatMap((checkIn) =>
        checkIn.score === null ? [] : [{ date: checkIn.answered_at, value: checkIn.score }],
      ),
    }
  }
  const question = form.questions.find((q) => q.logs_to?.metric !== undefined)
  const metric = question?.logs_to?.metric
  if (!question || metric === undefined) return null
  return {
    label: question.prompt,
    metric,
    points: oldestFirst.flatMap((checkIn) => {
      const answered = checkIn.questions.find((q) => q.key === question.key)
      const value = answered ? numericAnswer(answered, checkIn.answers[question.key]) : undefined
      return value === undefined ? [] : [{ date: checkIn.answered_at, value }]
    }),
  }
}

/** Whether Home shows the Due today card: the Check-ins page is in the menu and a live form has a schedule. */
export const showsDueCard = (forms: readonly CheckInForm[], checkInsHidden: boolean): boolean =>
  !checkInsHidden &&
  forms.some((form) => form.schedule !== null && !form.archived && form.deleted_at === null)

/** The slots Home lists: those still to do today, due ones first. */
export const openSlots = (slots: readonly DueSlot[]): DueSlot[] => [
  ...slots.filter((slot) => slot.state === 'due'),
  ...slots.filter((slot) => slot.state === 'upcoming'),
]

export interface SlotActions {
  confirm: boolean
  fill: boolean
  skip: boolean
}

/**
 * What a slot of today offers on the Check-ins page: a due slot is filled in or skipped, and a
 * routine's confirmed as preset; an upcoming slot can be filled in early.
 */
export const slotActions = (slot: Pick<DueSlot, 'state'>, isRoutine: boolean): SlotActions => {
  if (slot.state === 'due') return { confirm: isRoutine, fill: true, skip: true }
  return { confirm: false, fill: slot.state === 'upcoming', skip: false }
}

/** On Home's card a routine's due slot is Done or Skip in place; any other slot links to filling in. */
export const dueCardActions = (slot: Pick<DueSlot, 'state'>, isRoutine: boolean): SlotActions => {
  const actions = slotActions(slot, isRoutine)
  return actions.confirm ? { ...actions, fill: false } : { ...actions, skip: false }
}
