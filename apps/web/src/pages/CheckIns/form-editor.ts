import type {
  AddCheckInFormBody,
  CheckInForm,
  CheckInOption,
  CheckInQuestion,
  CheckInQuestionType,
  CheckInScore,
  Schedule,
  UpdateCheckInFormBody,
} from '@aurboda/api-spec'

import {
  CHECK_IN_OPTIONS_MAX,
  CHECK_IN_QUESTIONS_MAX,
  CHECK_IN_SCALE_STEPS_MAX,
  checkInFormProblems,
  DEFAULT_DAY_STARTS_AT,
  SCHEDULE_TIMES_MAX,
} from '@aurboda/api-spec'

import { ALL_DAYS, roundTime } from '../Reminders/reminder-form'

export const QUESTION_TYPES: { type: CheckInQuestionType; label: string }[] = [
  { label: 'Scale', type: 'scale' },
  { label: 'Yes or no', type: 'yes_no' },
  { label: 'Number', type: 'number' },
  { label: 'One choice', type: 'choice' },
  { label: 'Several choices', type: 'multi_choice' },
  { label: 'Text', type: 'text' },
]

export const METRIC_NAME_RE = /^[a-z][a-z0-9_]{0,49}$/
export const METRIC_NAME_RULE =
  'Lowercase letters, digits and underscores, starting with a letter (e.g. rested or mood_score).'
const METRIC_NAME_PROBLEM =
  'the metric name must be lowercase letters, digits and underscores, starting with a letter.'

const KEY_MAX = 40

export interface OptionDraft {
  /** Kept from the saved form; a new option gets its key from its label when saved. */
  key: string | null
  label: string
  value: string
}

export interface QuestionDraft {
  /** Local id for lists and the score's picks; never sent. */
  id: string
  /** Kept from the saved form; a new question gets its key from its prompt when saved. */
  key: string | null
  prompt: string
  type: CheckInQuestionType
  required: boolean
  min: string
  max: string
  step: string
  unit: string
  min_label: string
  max_label: string
  options: OptionDraft[]
  logs: boolean
  metric: string
}

export interface FormDraft {
  name: string
  description: string
  questions: QuestionDraft[]
  score_on: boolean
  /** Local ids of the questions summed. */
  score_questions: string[]
  score_factor: string
  score_metric: string
  schedule_on: boolean
  times: string[]
  weekdays: number[]
  start_date: string
  end_date: string
  day_starts_at: string
  notify: boolean
}

let nextId = 0
const localId = (): string => `q${++nextId}`

/** A key from text: lowercase letters, digits and underscores, starting with a letter, unique in `taken`. */
export const keyFromText = (text: string, taken: ReadonlySet<string>, fallback = 'question'): string => {
  const slug = text
    .normalize('NFKD')
    .replaceAll(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
  const lettered = /^[a-z]/.test(slug) ? slug : slug === '' ? fallback : `${fallback}_${slug}`
  const base = lettered.slice(0, KEY_MAX).replace(/_+$/, '')
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `_${n}`
    const candidate = `${base.slice(0, KEY_MAX - suffix.length).replace(/_+$/, '')}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

export const newQuestion = (type: CheckInQuestionType = 'scale'): QuestionDraft => ({
  id: localId(),
  key: null,
  logs: false,
  max: type === 'scale' ? '5' : '',
  max_label: '',
  metric: '',
  min: type === 'scale' ? '1' : '',
  min_label: '',
  options:
    type === 'choice' || type === 'multi_choice'
      ? [
          { key: null, label: '', value: '' },
          { key: null, label: '', value: '' },
        ]
      : [],
  prompt: '',
  required: false,
  step: '',
  type,
  unit: '',
})

/** The question with another type, keeping what both types share and filling in what the new one needs. */
export const changeType = (question: QuestionDraft, type: CheckInQuestionType): QuestionDraft => {
  const fresh = newQuestion(type)
  const keepsOptions = type === 'choice' || type === 'multi_choice'
  return {
    ...question,
    logs: canLog({ ...question, type }) ? question.logs : false,
    max: type === 'scale' && question.type !== 'scale' ? fresh.max : question.max,
    min: type === 'scale' && question.type !== 'scale' ? fresh.min : question.min,
    options: keepsOptions && question.options.length >= 2 ? question.options : fresh.options,
    type,
  }
}

/** Whether the answer can be saved as a metric: numbers, scales, yes/no, and a choice with a value on every option. */
export const canLog = (question: Pick<QuestionDraft, 'type' | 'options'>): boolean =>
  question.type === 'number' ||
  question.type === 'scale' ||
  question.type === 'yes_no' ||
  (question.type === 'choice' &&
    question.options.length > 0 &&
    question.options.every((option) => option.value.trim() !== ''))

/** Whether the question has a numeric answer a score can sum. */
export const canScore = canLog

const text = (value: number | undefined): string => (value === undefined ? '' : String(value))

const questionDraft = (question: CheckInQuestion): QuestionDraft => {
  const base = { ...newQuestion(question.type), key: question.key, prompt: question.prompt }
  const logs = { logs: question.logs_to !== undefined, metric: question.logs_to?.metric ?? '' }
  const required = question.required ?? false
  switch (question.type) {
    case 'number':
      return {
        ...base,
        ...logs,
        max: text(question.max),
        min: text(question.min),
        required,
        step: text(question.step),
        unit: question.unit ?? '',
      }
    case 'scale':
      return {
        ...base,
        ...logs,
        max: String(question.max),
        max_label: question.max_label ?? '',
        min: String(question.min),
        min_label: question.min_label ?? '',
        required,
      }
    case 'choice':
    case 'multi_choice':
      return {
        ...base,
        ...logs,
        options: question.options.map((option) => ({
          key: option.key,
          label: option.label,
          value: text(option.value),
        })),
        required,
      }
    default:
      return { ...base, ...logs, required }
  }
}

export const emptyFormDraft = (): FormDraft => ({
  day_starts_at: DEFAULT_DAY_STARTS_AT,
  description: '',
  end_date: '',
  name: '',
  notify: true,
  questions: [newQuestion('scale')],
  schedule_on: false,
  score_factor: '1',
  score_metric: '',
  score_on: false,
  score_questions: [],
  start_date: '',
  times: ['08:00'],
  weekdays: [...ALL_DAYS],
})

const scheduleDraft = (schedule: Schedule | null): Partial<FormDraft> =>
  schedule
    ? {
        day_starts_at: schedule.day_starts_at,
        end_date: schedule.end_date ?? '',
        schedule_on: true,
        start_date: schedule.start_date ?? '',
        times: schedule.times,
        weekdays: schedule.weekdays,
      }
    : {}

const scoreDraft = (score: CheckInScore | null, questions: readonly QuestionDraft[]): Partial<FormDraft> => {
  if (!score) return {}
  const idByKey = new Map(questions.map((question) => [question.key, question.id]))
  return {
    score_factor: text(score.factor ?? 1),
    score_metric: score.metric,
    score_on: true,
    score_questions: score.questions.flatMap((key) => {
      const id = idByKey.get(key)
      return id ? [id] : []
    }),
  }
}

export const draftFromForm = (form: CheckInForm): FormDraft => {
  const questions = form.questions.map(questionDraft)
  return {
    ...emptyFormDraft(),
    description: form.description ?? '',
    name: form.name,
    notify: form.notify,
    questions,
    ...scheduleDraft(form.schedule),
    ...scoreDraft(form.score, questions),
  }
}

export const moveQuestion = (
  questions: readonly QuestionDraft[],
  index: number,
  by: -1 | 1,
): QuestionDraft[] => {
  const to = index + by
  if (to < 0 || to >= questions.length) return [...questions]
  const next = [...questions]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}

const parseNumber = (value: string): number | undefined => {
  const trimmed = value.trim().replace(',', '.')
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : NaN
}

interface Built<T> {
  value: T
  errors: string[]
}

const buildOptions = (question: QuestionDraft, label: string): Built<CheckInOption[]> => {
  const errors: string[] = []
  const taken = new Set(question.options.flatMap((option) => (option.key ? [option.key] : [])))
  const options = question.options.map((option) => {
    const key = option.key ?? keyFromText(option.label, taken, 'option')
    taken.add(key)
    const value = parseNumber(option.value)
    if (value !== undefined && Number.isNaN(value)) {
      errors.push(`${label}: an option's value must be a number.`)
    }
    return { key, label: option.label.trim(), ...(value === undefined ? {} : { value }) }
  })
  if (options.length < 2) errors.push(`${label}: give at least two options.`)
  if (options.length > CHECK_IN_OPTIONS_MAX) errors.push(`${label}: at most ${CHECK_IN_OPTIONS_MAX} options.`)
  if (options.some((option) => option.label === '')) errors.push(`${label}: every option needs a label.`)
  return { errors, value: options }
}

type QuestionBase = Pick<CheckInQuestion, 'key' | 'prompt' | 'required' | 'logs_to'>

const buildNumber = (question: QuestionDraft, label: string, base: QuestionBase): Built<CheckInQuestion> => {
  const errors: string[] = []
  const min = parseNumber(question.min)
  const max = parseNumber(question.max)
  const step = parseNumber(question.step)
  if ([min, max, step].some((n) => n !== undefined && Number.isNaN(n))) {
    errors.push(`${label}: lowest, highest and step must be numbers.`)
  } else if (min !== undefined && max !== undefined && min >= max) {
    errors.push(`${label}: the highest must be above the lowest.`)
  }
  if (step !== undefined && step <= 0) errors.push(`${label}: the step must be above 0.`)
  const unit = question.unit.trim()
  return {
    errors,
    value: {
      ...base,
      type: 'number',
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
      ...(step === undefined ? {} : { step }),
      ...(unit ? { unit } : {}),
    },
  }
}

const scaleError = (min: number | undefined, max: number | undefined): string | null => {
  if (min === undefined || max === undefined || !Number.isInteger(min) || !Number.isInteger(max)) {
    return "a scale's ends must be whole numbers."
  }
  if (min >= max) return 'the top of the scale must be above the bottom.'
  if (max - min + 1 > CHECK_IN_SCALE_STEPS_MAX) {
    return `a scale has at most ${CHECK_IN_SCALE_STEPS_MAX} points.`
  }
  return null
}

const buildScale = (question: QuestionDraft, label: string, base: QuestionBase): Built<CheckInQuestion> => {
  const min = parseNumber(question.min)
  const max = parseNumber(question.max)
  const error = scaleError(min, max)
  const minLabel = question.min_label.trim()
  const maxLabel = question.max_label.trim()
  return {
    errors: error ? [`${label}: ${error}`] : [],
    value: {
      ...base,
      max: max ?? 0,
      min: min ?? 0,
      type: 'scale',
      ...(minLabel ? { min_label: minLabel } : {}),
      ...(maxLabel ? { max_label: maxLabel } : {}),
    },
  }
}

const buildTyped = (question: QuestionDraft, label: string, base: QuestionBase): Built<CheckInQuestion> => {
  switch (question.type) {
    case 'number':
      return buildNumber(question, label, base)
    case 'scale':
      return buildScale(question, label, base)
    case 'choice':
    case 'multi_choice': {
      const options = buildOptions(question, label)
      return { errors: options.errors, value: { ...base, options: options.value, type: question.type } }
    }
    case 'yes_no':
    case 'text':
      return { errors: [], value: { ...base, type: question.type } }
  }
}

const buildQuestion = (question: QuestionDraft, index: number, key: string): Built<CheckInQuestion> => {
  const label = `Question ${index + 1}`
  const errors: string[] = []
  const prompt = question.prompt.trim()
  if (prompt === '') errors.push(`${label}: write the question.`)
  const metric = question.metric.trim()
  const logs = question.logs && canLog(question)
  if (logs && !METRIC_NAME_RE.test(metric)) errors.push(`${label}: ${METRIC_NAME_PROBLEM}`)
  const base: QuestionBase = {
    key,
    prompt,
    required: question.required,
    ...(logs ? { logs_to: { metric } } : {}),
  }
  const built = buildTyped(question, label, base)
  return { errors: [...errors, ...built.errors], value: built.value }
}

export interface BuiltForm {
  name: string
  description: string
  questions: CheckInQuestion[]
  score: CheckInScore | null
  schedule: Schedule | null
  notify: boolean
}

export type BuildResult = { ok: true; value: BuiltForm } | { ok: false; errors: string[] }

const buildScore = (draft: FormDraft, keyById: Map<string, string>): Built<CheckInScore | null> => {
  if (!draft.score_on) return { errors: [], value: null }
  const errors: string[] = []
  const metric = draft.score_metric.trim()
  if (!METRIC_NAME_RE.test(metric)) errors.push(`Score: ${METRIC_NAME_PROBLEM}`)
  const questions = draft.score_questions.flatMap((id) => {
    const key = keyById.get(id)
    return key ? [key] : []
  })
  if (questions.length === 0) errors.push('Score: pick the questions to add up.')
  const factor = parseNumber(draft.score_factor)
  if (factor !== undefined && (Number.isNaN(factor) || factor === 0)) {
    errors.push('Score: the factor must be a number other than 0.')
  }
  return {
    errors,
    value: { metric, questions, ...(factor === undefined || factor === 1 ? {} : { factor }) },
  }
}

const buildSchedule = (draft: FormDraft): Built<Schedule | null> => {
  if (!draft.schedule_on) return { errors: [], value: null }
  const errors: string[] = []
  const rounded = draft.times.map(roundTime)
  if (rounded.some((time) => time === null)) errors.push('Schedule: every time must be a time of day.')
  const times = [...new Set(rounded.filter((time): time is string => time !== null))].sort()
  if (times.length === 0) errors.push('Schedule: add at least one time.')
  if (times.length > SCHEDULE_TIMES_MAX) errors.push(`Schedule: at most ${SCHEDULE_TIMES_MAX} times.`)
  const weekdays = [...new Set(draft.weekdays)].sort((a, b) => a - b)
  if (weekdays.length === 0) errors.push('Schedule: pick at least one day.')
  const dayStartsAt = roundTime(draft.day_starts_at)
  if (dayStartsAt === null) errors.push('Schedule: the day must start at a time of day.')
  if (draft.start_date && draft.end_date && draft.end_date < draft.start_date) {
    errors.push('Schedule: the end date must not be before the start date.')
  }
  return {
    errors,
    value: {
      day_starts_at: dayStartsAt ?? DEFAULT_DAY_STARTS_AT,
      times,
      weekdays,
      ...(draft.start_date ? { start_date: draft.start_date } : {}),
      ...(draft.end_date ? { end_date: draft.end_date } : {}),
    },
  }
}

/** The form as the API takes it, or every problem in plain words. New questions and options get keys here. */
export const buildForm = (draft: FormDraft): BuildResult => {
  const errors: string[] = []
  const name = draft.name.trim()
  if (name === '') errors.push('Give the form a name.')
  if (draft.questions.length === 0) errors.push('Add at least one question.')
  if (draft.questions.length > CHECK_IN_QUESTIONS_MAX) {
    errors.push(`At most ${CHECK_IN_QUESTIONS_MAX} questions.`)
  }
  const taken = new Set(draft.questions.flatMap((question) => (question.key ? [question.key] : [])))
  const keyById = new Map<string, string>()
  const questions = draft.questions.map((question, index) => {
    const key = question.key ?? keyFromText(question.prompt, taken)
    taken.add(key)
    keyById.set(question.id, key)
    const built = buildQuestion(question, index, key)
    errors.push(...built.errors)
    return built.value
  })
  const score = buildScore(draft, keyById)
  const schedule = buildSchedule(draft)
  errors.push(...score.errors, ...schedule.errors)
  if (errors.length === 0) {
    errors.push(...checkInFormProblems(questions, score.value).map((problem) => `${problem.message}.`))
  }
  if (errors.length > 0) return { errors, ok: false }
  return {
    ok: true,
    value: {
      description: draft.description.trim(),
      name,
      notify: draft.notify,
      questions,
      schedule: schedule.value,
      score: score.value,
    },
  }
}

export const toAddBody = (form: BuiltForm): AddCheckInFormBody => ({
  name: form.name,
  notify: form.notify,
  questions: form.questions,
  ...(form.description ? { description: form.description } : {}),
  ...(form.schedule ? { schedule: form.schedule } : {}),
  ...(form.score ? { score: form.score } : {}),
})

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

const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b)

/** Only what changed, so an unchanged schedule does not restart and an unchanged score keeps its version. */
export const toUpdateBody = (existing: CheckInForm, form: BuiltForm): UpdateCheckInFormBody => {
  const body: UpdateCheckInFormBody = {}
  if (form.name !== existing.name) body.name = form.name
  if (form.description !== (existing.description ?? '')) body.description = form.description || null
  if (!same(form.questions, existing.questions)) body.questions = form.questions
  if (!same(form.score, existing.score)) body.score = form.score
  if (!same(form.schedule, existing.schedule)) body.schedule = form.schedule
  if (form.notify !== existing.notify) body.notify = form.notify
  return body
}

const normalizedQuestion = (question: CheckInQuestion): string =>
  canonical({ ...question, required: question.required ?? false })

const normalizedScore = (score: CheckInScore | null): string =>
  score ? canonical({ ...score, factor: score.factor ?? 1, questions: [...score.questions].sort() }) : 'null'

/** Mirrors the server: a question added, removed or changed other than in its place, or the score changed. */
export const startsNewVersion = (
  existing: Pick<CheckInForm, 'questions' | 'score'>,
  next: Pick<BuiltForm, 'questions' | 'score'>,
): boolean => {
  if (normalizedScore(existing.score) !== normalizedScore(next.score)) return true
  if (existing.questions.length !== next.questions.length) return true
  const before = new Map(existing.questions.map((question) => [question.key, normalizedQuestion(question)]))
  return next.questions.some((question) => before.get(question.key) !== normalizedQuestion(question))
}
