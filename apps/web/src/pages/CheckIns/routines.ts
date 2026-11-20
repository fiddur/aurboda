import type {
  CheckIn,
  CheckInAdherence,
  CheckInAdherenceDay,
  CheckInAnswerValue,
  CheckInForm,
  CheckInQuestion,
} from '@aurboda/api-spec'

import type { AnswerDraft, AnswerDrafts } from './answers'

const isBlank = (value: CheckInAnswerValue | undefined): boolean =>
  value === undefined ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0)

/** Mirrors the server: an answer counts as taken when given, and not 0 or no. */
export const isTakenAnswer = (question: CheckInQuestion, value: CheckInAnswerValue | undefined): boolean => {
  if (isBlank(value)) return false
  if (question.type === 'yes_no') return value === true
  if (question.type === 'number' || question.type === 'scale') return typeof value === 'number' && value !== 0
  return true
}

const optionLabel = (question: CheckInQuestion, key: string): string =>
  'options' in question ? (question.options.find((option) => option.key === key)?.label ?? key) : key

const presetItem = (question: CheckInQuestion, value: CheckInAnswerValue): string | null => {
  if (!isTakenAnswer(question, value)) return null
  switch (question.type) {
    case 'number':
      return `${question.prompt} ${value}${question.unit ? ` ${question.unit}` : ''}`
    case 'scale':
      return `${question.prompt} ${value}`
    case 'yes_no':
      return question.prompt
    case 'choice':
      return `${question.prompt}: ${optionLabel(question, String(value))}`
    case 'multi_choice':
      return `${question.prompt}: ${(Array.isArray(value) ? value : []).map((key) => optionLabel(question, key)).join(', ')}`
    case 'text':
      return `${question.prompt}: ${value}`
  }
}

/** The answers taken, in a line: "Vitamin D 50 µg, Magnesium 200 mg"; 0, no and blanks left out. */
export const answersLine = (
  questions: readonly CheckInQuestion[],
  answers: Readonly<Record<string, CheckInAnswerValue | undefined>>,
): string =>
  questions
    .flatMap((question) => {
      const value = answers[question.key]
      const item = value === undefined ? null : presetItem(question, value)
      return item ? [item] : []
    })
    .join(', ')

/** Mirrors the server's notification body: a routine's preset items in a line. */
export const presetLine = (questions: readonly CheckInQuestion[]): string =>
  answersLine(questions, Object.fromEntries(questions.map((question) => [question.key, question.default])))

/** The routines without a schedule, taken when needed: one large button each on the Check-ins page. */
export const asNeededRoutines = (forms: readonly CheckInForm[]): CheckInForm[] =>
  forms.filter(
    (form) => form.is_routine && form.schedule === null && !form.archived && form.deleted_at === null,
  )

/** The questions a routine lists as items: those with a preset answer. */
export const routineItems = (questions: readonly CheckInQuestion[]): CheckInQuestion[] =>
  questions.filter((question) => !isBlank(question.default))

/** An item can be left out unless it is required and its type has no "not taken" answer (0 or no). */
export const canLeaveOut = (question: CheckInQuestion): boolean => {
  if (!question.required) return true
  if (question.type === 'yes_no') return true
  if (question.type === 'number') return question.min === undefined || question.min <= 0
  if (question.type === 'scale') return question.min <= 0
  return false
}

const notTaken = (question: CheckInQuestion): CheckInAnswerValue | undefined => {
  if (!question.required) return undefined
  return question.type === 'yes_no' ? false : 0
}

export interface RoutineDraft {
  /** Keys of the items left out. */
  left_out: string[]
  /** Answer drafts of every question, the items starting at their preset. */
  drafts: AnswerDrafts
}

const presetDraft = (question: CheckInQuestion): AnswerDraft =>
  question.type === 'number' && typeof question.default === 'number'
    ? String(question.default)
    : question.default

export const routineDraft = (questions: readonly CheckInQuestion[]): RoutineDraft => ({
  drafts: Object.fromEntries(
    routineItems(questions).map((question) => [question.key, presetDraft(question)]),
  ),
  left_out: [],
})

/**
 * The drafts a routine saves: an item left out is no answer, or 0 / no when it is required. Read with
 * `draftsToAnswers` and `answerProblems` like any other drafts.
 */
export const routineDrafts = (questions: readonly CheckInQuestion[], routine: RoutineDraft): AnswerDrafts => {
  const drafts: AnswerDrafts = { ...routine.drafts }
  for (const key of routine.left_out) {
    const question = questions.find((q) => q.key === key)
    if (!question) continue
    const value = notTaken(question)
    drafts[key] = question.type === 'number' && typeof value === 'number' ? String(value) : value
  }
  return drafts
}

export type AdherenceState = 'done' | 'skipped' | 'missed' | 'upcoming'

const STATE_ORDER: AdherenceState[] = ['done', 'skipped', 'missed', 'upcoming']

export interface AdherenceCell {
  date: string
  /** One per slot of the day, done first. */
  slots: AdherenceState[]
  /** "Thu 19 Nov: 1 done, 1 missed", or "no slots". */
  label: string
}

const weekday = (date: string): string =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    weekday: 'short',
  })

/** The strip's cells: each day of the window with its slots by state, oldest first. */
export const adherenceCells = (days: readonly CheckInAdherenceDay[]): AdherenceCell[] =>
  days.map((day) => {
    const slots = STATE_ORDER.flatMap((state) => Array.from({ length: day[state] }, () => state))
    const counts = STATE_ORDER.filter((state) => day[state] > 0).map((state) => `${day[state]} ${state}`)
    return {
      date: day.date,
      label: `${weekday(day.date)}: ${counts.length > 0 ? counts.join(', ') : 'no slots'}`,
      slots,
    }
  })

/** Whether the strip has anything to show: a slot on some day of the window. */
export const hasSlots = (adherence: Pick<CheckInAdherence, 'totals'>): boolean => {
  const { done, missed, skipped, upcoming } = adherence.totals
  return done + missed + skipped + upcoming > 0
}

/** "Taken 22 of 25 times" per question, for how often each item of a routine was taken. */
export const itemCounts = (
  adherence: Pick<CheckInAdherence, 'answered_check_ins' | 'questions'>,
): { key: string; prompt: string; line: string; share: number }[] =>
  adherence.questions.map((question) => ({
    key: question.key,
    line: `${question.answered} of ${adherence.answered_check_ins}`,
    prompt: question.prompt,
    share: adherence.answered_check_ins === 0 ? 0 : question.answered / adherence.answered_check_ins,
  }))

/** The question keys whose activity was deleted on its own, so the answer is no longer logged. */
export const unloggedKeys = (checkIn: Pick<CheckIn, 'activities'>): Set<string> =>
  new Set(
    Object.entries(checkIn.activities)
      .filter(([, activity]) => !activity.logged)
      .map(([key]) => key),
  )
