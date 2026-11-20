import {
  CHECK_IN_SCORE_KEY,
  type CheckInAnswerValue,
  type CheckInQuestion,
  type CheckInScore,
  isNumericCheckInQuestion,
} from '@aurboda/api-spec'

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const normalizedQuestion = (question: CheckInQuestion): string =>
  canonical({ ...question, required: question.required ?? false })

const normalizedScore = (score: CheckInScore | null | undefined): string =>
  score ? canonical({ ...score, factor: score.factor ?? 1, questions: [...score.questions].sort() }) : 'null'

/**
 * Whether going from one definition to the other makes a new version: a question added, removed or
 * changed in anything but its place, or the score changed. Order alone does not.
 */
export const definitionChanged = (
  before: { questions: readonly CheckInQuestion[]; score: CheckInScore | null | undefined },
  after: { questions: readonly CheckInQuestion[]; score: CheckInScore | null | undefined },
): boolean => {
  if (normalizedScore(before.score) !== normalizedScore(after.score)) return true
  if (before.questions.length !== after.questions.length) return true
  const old = new Map(before.questions.map((question) => [question.key, normalizedQuestion(question)]))
  return after.questions.some((question) => old.get(question.key) !== normalizedQuestion(question))
}

/**
 * A key removed from the form earlier may come back only with the type it had: answers stored under
 * it must keep their meaning.
 */
export const reusedKeyProblems = (
  history: readonly (readonly CheckInQuestion[])[],
  current: readonly CheckInQuestion[],
  next: readonly CheckInQuestion[],
): string[] => {
  const live = new Set(current.map((question) => question.key))
  const removedTypes = new Map<string, Set<string>>()
  for (const questions of history) {
    for (const question of questions) {
      if (live.has(question.key)) continue
      const types = removedTypes.get(question.key) ?? new Set<string>()
      types.add(question.type)
      removedTypes.set(question.key, types)
    }
  }
  return next.flatMap((question) => {
    const types = removedTypes.get(question.key)
    if (!types || (types.size === 1 && types.has(question.type))) return []
    return [
      `Question key "${question.key}" was used before for a ${[...types].join('/')} question and cannot be reused for a ${question.type} question; pick another key`,
    ]
  })
}

type Problem<T extends CheckInQuestion['type']> = (
  question: Extract<CheckInQuestion, { type: T }>,
  value: CheckInAnswerValue,
  label: string,
) => string | null

const numberProblem: Problem<'number'> = (question, value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${label} must be a number`
  if (question.min !== undefined && value < question.min) return `${label} must be at least ${question.min}`
  if (question.max !== undefined && value > question.max) return `${label} must be at most ${question.max}`
  return null
}

const scaleProblem: Problem<'scale'> = (question, value, label) =>
  typeof value === 'number' && Number.isInteger(value) && value >= question.min && value <= question.max
    ? null
    : `${label} must be a whole number from ${question.min} to ${question.max}`

const choiceProblem: Problem<'choice'> = (question, value, label) =>
  typeof value === 'string' && question.options.some((option) => option.key === value)
    ? null
    : `${label} must be one of ${question.options.map((option) => option.key).join(', ')}`

const multiChoiceProblem: Problem<'multi_choice'> = (question, value, label) => {
  if (!Array.isArray(value)) return `${label} must be a list of option keys`
  const keys = new Set(question.options.map((option) => option.key))
  if (new Set(value).size !== value.length) return `${label} lists an option twice`
  const unknown = value.find((key) => !keys.has(key))
  return unknown === undefined ? null : `${label} has no option "${unknown}"`
}

const answerProblem = (question: CheckInQuestion, value: CheckInAnswerValue): string | null => {
  const label = `"${question.key}"`
  switch (question.type) {
    case 'number':
      return numberProblem(question, value, label)
    case 'scale':
      return scaleProblem(question, value, label)
    case 'yes_no':
      return typeof value === 'boolean' ? null : `${label} must be true or false`
    case 'choice':
      return choiceProblem(question, value, label)
    case 'multi_choice':
      return multiChoiceProblem(question, value, label)
    case 'text':
      return typeof value === 'string' ? null : `${label} must be text`
  }
}

const isBlank = (value: CheckInAnswerValue | undefined): boolean =>
  value === undefined ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0)

/** What is wrong with the answers to these questions; empty when nothing is. */
export const answerProblems = (
  questions: readonly CheckInQuestion[],
  answers: Record<string, CheckInAnswerValue>,
): string[] => {
  const byKey = new Map(questions.map((question) => [question.key, question]))
  const problems = Object.keys(answers)
    .filter((key) => !byKey.has(key))
    .map((key) => `No question "${key}" in this form`)
  for (const question of questions) {
    const value = answers[question.key]
    if (isBlank(value)) {
      if (question.required) problems.push(`"${question.key}" is required`)
      continue
    }
    const problem = answerProblem(question, value!)
    if (problem) problems.push(problem)
  }
  return problems
}

/** The number an answer stands for: the value itself, yes as 1 and no as 0, or the chosen option's value. */
export const numericAnswer = (
  question: CheckInQuestion,
  value: CheckInAnswerValue | undefined,
): number | undefined => {
  if (value === undefined || !isNumericCheckInQuestion(question)) return undefined
  if (question.type === 'yes_no') return typeof value === 'boolean' ? (value ? 1 : 0) : undefined
  if (question.type === 'choice') return question.options.find((option) => option.key === value)?.value
  return typeof value === 'number' ? value : undefined
}

/** The score of the answers, or null when the form has none or one of its answers is missing. */
export const scoreOf = (
  questions: readonly CheckInQuestion[],
  score: CheckInScore | null | undefined,
  answers: Record<string, CheckInAnswerValue>,
): number | null => {
  if (!score) return null
  const byKey = new Map(questions.map((question) => [question.key, question]))
  let sum = 0
  for (const key of score.questions) {
    const question = byKey.get(key)
    const value = question ? numericAnswer(question, answers[key]) : undefined
    if (value === undefined) return null
    sum += value
  }
  return sum * (score.factor ?? 1)
}

export interface CheckInMetricPoint {
  /** The question key, or `CHECK_IN_SCORE_KEY` for the score. */
  key: string
  metric: string
  value: number
  unit?: string
}

/**
 * The metric points a check-in's answers make. An answer of 0, no, or none logs nothing; the score
 * is a total, so a score of 0 is logged.
 */
export const metricPointsFor = (
  questions: readonly CheckInQuestion[],
  score: CheckInScore | null | undefined,
  answers: Record<string, CheckInAnswerValue>,
): CheckInMetricPoint[] => {
  const points: CheckInMetricPoint[] = []
  for (const question of questions) {
    if (!question.logs_to) continue
    const value = numericAnswer(question, answers[question.key])
    if (value === undefined || value === 0) continue
    const unit = question.type === 'number' ? question.unit : undefined
    points.push({ key: question.key, metric: question.logs_to.metric, value, ...(unit ? { unit } : {}) })
  }
  const total = scoreOf(questions, score, answers)
  if (score && total !== null) points.push({ key: CHECK_IN_SCORE_KEY, metric: score.metric, value: total })
  return points
}
