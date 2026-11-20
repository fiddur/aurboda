import type { CheckInAnswerValue, CheckInQuestion } from '@aurboda/api-spec'

/** A number question's draft is the text in its input; every other type holds its answer as sent. */
export type AnswerDraft = CheckInAnswerValue | undefined

export type AnswerDrafts = Record<string, AnswerDraft>

const isBlank = (value: AnswerDraft): boolean =>
  value === undefined ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0)

/** The answers to send: blank drafts left out, number text read as a number. */
export const draftsToAnswers = (
  questions: readonly CheckInQuestion[],
  drafts: AnswerDrafts,
): Record<string, CheckInAnswerValue> => {
  const answers: Record<string, CheckInAnswerValue> = {}
  for (const question of questions) {
    const draft = drafts[question.key]
    if (draft === undefined || isBlank(draft)) continue
    if (question.type === 'number' && typeof draft === 'string') {
      answers[question.key] = Number(draft.trim().replace(',', '.'))
    } else if (question.type === 'text' && typeof draft === 'string') {
      answers[question.key] = draft.trim()
    } else {
      answers[question.key] = draft
    }
  }
  return answers
}

/** The drafts that show a saved check-in's answers again, to edit them. */
export const answersToDrafts = (
  questions: readonly CheckInQuestion[],
  answers: Record<string, CheckInAnswerValue>,
): AnswerDrafts => {
  const drafts: AnswerDrafts = {}
  for (const question of questions) {
    const value = answers[question.key]
    if (value === undefined) continue
    drafts[question.key] = question.type === 'number' && typeof value === 'number' ? String(value) : value
  }
  return drafts
}

/** The required questions with no answer, in form order. */
export const missingRequired = (
  questions: readonly CheckInQuestion[],
  drafts: AnswerDrafts,
): CheckInQuestion[] => questions.filter((question) => question.required && isBlank(drafts[question.key]))

const decimals = (value: number): number => {
  const text = String(value)
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}

/** Steps a number draft by one `step` (1 by default), kept within min and max. */
export const stepNumber = (
  question: Extract<CheckInQuestion, { type: 'number' }>,
  draft: AnswerDraft,
  direction: 1 | -1,
): string => {
  const step = question.step ?? 1
  const current = typeof draft === 'string' && draft.trim() !== '' ? Number(draft.replace(',', '.')) : NaN
  const start = Number.isFinite(current)
    ? current + direction * step
    : direction > 0
      ? (question.min ?? 0)
      : (question.max ?? question.min ?? 0)
  const bounded = Math.min(question.max ?? Infinity, Math.max(question.min ?? -Infinity, start))
  return String(Number(bounded.toFixed(Math.max(decimals(step), decimals(question.min ?? 0)))))
}

type Check<T extends CheckInQuestion['type']> = (
  question: Extract<CheckInQuestion, { type: T }>,
  value: CheckInAnswerValue,
  label: string,
) => string | null

const numberProblem: Check<'number'> = (question, value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${label} must be a number.`
  if (question.min !== undefined && value < question.min) return `${label} must be at least ${question.min}.`
  if (question.max !== undefined && value > question.max) return `${label} must be at most ${question.max}.`
  return null
}

const scaleProblem: Check<'scale'> = (question, value, label) =>
  typeof value === 'number' && Number.isInteger(value) && value >= question.min && value <= question.max
    ? null
    : `${label} must be from ${question.min} to ${question.max}.`

const choiceProblem: Check<'choice'> = (question, value, label) =>
  typeof value === 'string' && question.options.some((option) => option.key === value)
    ? null
    : `Pick one of the options for ${label}.`

const multiChoiceProblem: Check<'multi_choice'> = (question, value, label) =>
  Array.isArray(value) && value.every((key) => question.options.some((option) => option.key === key))
    ? null
    : `Pick from the options for ${label}.`

const answerProblem = (question: CheckInQuestion, value: CheckInAnswerValue): string | null => {
  const label = `“${question.prompt}”`
  switch (question.type) {
    case 'number':
      return numberProblem(question, value, label)
    case 'scale':
      return scaleProblem(question, value, label)
    case 'yes_no':
      return typeof value === 'boolean' ? null : `${label} must be yes or no.`
    case 'choice':
      return choiceProblem(question, value, label)
    case 'multi_choice':
      return multiChoiceProblem(question, value, label)
    case 'text':
      return typeof value === 'string' ? null : `${label} must be text.`
  }
}

/**
 * What is wrong with the drafts, in plain words, mirroring the server's checks: required questions
 * unanswered, numbers out of range, unknown options. Empty when they can be saved.
 */
export const answerProblems = (questions: readonly CheckInQuestion[], drafts: AnswerDrafts): string[] => {
  const missing = missingRequired(questions, drafts)
  const problems = missing.length
    ? [`Please answer ${missing.map((question) => `“${question.prompt}”`).join(', ')}.`]
    : []
  const answers = draftsToAnswers(questions, drafts)
  for (const question of questions) {
    const value = answers[question.key]
    if (value === undefined) continue
    const problem = answerProblem(question, value)
    if (problem) problems.push(problem)
  }
  return problems
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A Date as the value of a `datetime-local` input, in local time. */
export const toLocalInput = (at: Date): string =>
  `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`

/** A `datetime-local` value as an ISO instant; null when it is not a time. */
export const fromLocalInput = (value: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}
