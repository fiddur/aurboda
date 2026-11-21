import type {
  AddCheckInFormBody,
  CheckInAnswerValue,
  CheckInForm,
  CheckInLogsTo,
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
  isCheckInRoutine,
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

export type LogAs = 'metric' | 'activity'

export type FieldKind = 'string' | 'number' | 'boolean'

export interface ActivityFieldDraft {
  name: string
  value: string
  kind: FieldKind
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
  log_as: LogAs
  metric: string
  activity_type: string
  activity_fields: ActivityFieldDraft[]
  answer_field: string
  /**
   * The preset answer as typed: a number's or scale's text, `yes` or `no`, a choice's option index,
   * a text, or a multi-choice's option indexes joined by commas.
   */
  preset: string
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
  activity_fields: [],
  activity_type: '',
  answer_field: '',
  id: localId(),
  key: null,
  log_as: 'metric',
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
  preset: '',
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
  const numeric = (t: CheckInQuestionType) => t === 'number' || t === 'scale'
  const next = { ...question, type }
  return {
    ...question,
    logs: question.logs && (question.log_as === 'activity' ? canLogActivity(next) : canLog(next)),
    max: type === 'scale' && question.type !== 'scale' ? fresh.max : question.max,
    min: type === 'scale' && question.type !== 'scale' ? fresh.min : question.min,
    options: keepsOptions && question.options.length >= 2 ? question.options : fresh.options,
    preset: numeric(type) && numeric(question.type) ? question.preset : '',
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

/** Whether the answer can be saved as an activity: numbers, scales and yes/no. */
export const canLogActivity = (question: Pick<QuestionDraft, 'type'>): boolean =>
  question.type === 'number' || question.type === 'scale' || question.type === 'yes_no'

const presetIndexes = (preset: string): number[] =>
  preset
    .split(',')
    .filter((part) => part.trim() !== '')
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0)

/** Whether a multi-choice's preset ticks the option at `index`. */
export const presetTicks = (preset: string, index: number): boolean => presetIndexes(preset).includes(index)

/** A multi-choice's preset with the option at `index` ticked or not, in option order. */
export const togglePresetOption = (preset: string, index: number, ticked: boolean): string =>
  [...new Set([...presetIndexes(preset).filter((i) => i !== index), ...(ticked ? [index] : [])])]
    .sort((a, b) => a - b)
    .join(',')

/** The preset of a choice or multi-choice once the option at `removed` is gone: it keeps the same options. */
export const presetWithoutOption = (preset: string, removed: number): string =>
  presetIndexes(preset)
    .filter((index) => index !== removed)
    .map((index) => (index > removed ? index - 1 : index))
    .join(',')

/** Whether the question has a numeric answer a score can sum. */
export const canScore = canLog

/** Mirrors the server's routine rule on the draft: every required question has a preset, and one does. */
export const draftIsRoutine = (questions: readonly Pick<QuestionDraft, 'preset' | 'required'>[]): boolean =>
  isCheckInRoutine(
    questions.map((question, index) => ({
      key: `q${index}`,
      prompt: 'q',
      required: question.required,
      type: 'text',
      ...(question.preset.trim() === '' ? {} : { default: question.preset }),
    })),
  )

const text = (value: number | undefined): string => (value === undefined ? '' : String(value))

const fieldKind = (value: string | number | boolean): FieldKind =>
  typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string'

const logsDraft = (logsTo: CheckInLogsTo | undefined): Partial<QuestionDraft> => {
  if (!logsTo) return { logs: false }
  if (logsTo.activity_type !== undefined) {
    return {
      activity_fields: Object.entries(logsTo.fields ?? {}).map(([name, value]) => ({
        kind: fieldKind(value),
        name,
        value: String(value),
      })),
      activity_type: logsTo.activity_type,
      answer_field: logsTo.answer_field ?? '',
      log_as: 'activity',
      logs: true,
    }
  }
  return { log_as: 'metric', logs: true, metric: logsTo.metric ?? '' }
}

const presetDraft = (question: CheckInQuestion): string => {
  const value = question.default
  if (value === undefined) return ''
  switch (question.type) {
    case 'yes_no':
      return value === true ? 'yes' : value === false ? 'no' : ''
    case 'choice': {
      const index = question.options.findIndex((option) => option.key === value)
      return index < 0 ? '' : String(index)
    }
    case 'multi_choice':
      return Array.isArray(value)
        ? question.options.flatMap((option, index) => (value.includes(option.key) ? [index] : [])).join(',')
        : ''
    default:
      return typeof value === 'number' || typeof value === 'string' ? String(value) : ''
  }
}

const questionDraft = (question: CheckInQuestion): QuestionDraft => {
  const base = {
    ...newQuestion(question.type),
    key: question.key,
    preset: presetDraft(question),
    prompt: question.prompt,
  }
  const logs = logsDraft(question.logs_to)
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

const fieldValue = (field: ActivityFieldDraft): string | number | boolean | undefined => {
  const typed = field.value.trim()
  if (typed === '') return undefined
  if (field.kind === 'number') return parseNumber(typed)
  if (field.kind === 'boolean') return typed === 'true'
  return typed
}

const buildActivityLog = (question: QuestionDraft, label: string): Built<CheckInLogsTo | undefined> => {
  const errors: string[] = []
  const activityType = question.activity_type.trim()
  if (activityType === '') errors.push(`${label}: pick the activity type to save the answer as.`)
  const answerField = question.type === 'yes_no' ? '' : question.answer_field.trim()
  const fields: Record<string, string | number | boolean> = {}
  for (const field of question.activity_fields) {
    const name = field.name.trim()
    const value = fieldValue(field)
    if (name === '' || name === answerField || value === undefined) continue
    if (typeof value === 'number' && Number.isNaN(value)) {
      errors.push(`${label}: the field ${name} must be a number.`)
      continue
    }
    fields[name] = value
  }
  return {
    errors,
    value: {
      activity_type: activityType,
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
      ...(answerField ? { answer_field: answerField } : {}),
    },
  }
}

const buildLogsTo = (question: QuestionDraft, label: string): Built<CheckInLogsTo | undefined> => {
  if (!question.logs) return { errors: [], value: undefined }
  if (question.log_as === 'activity') {
    return canLogActivity(question) ? buildActivityLog(question, label) : { errors: [], value: undefined }
  }
  if (!canLog(question)) return { errors: [], value: undefined }
  const metric = question.metric.trim()
  return {
    errors: METRIC_NAME_RE.test(metric) ? [] : [`${label}: ${METRIC_NAME_PROBLEM}`],
    value: { metric },
  }
}

const numberPresetProblem = (question: CheckInQuestion, value: number): string | null => {
  if (Number.isNaN(value)) return 'the preset answer must be a number.'
  if (question.type === 'scale') {
    return Number.isInteger(value) && value >= question.min && value <= question.max
      ? null
      : `the preset answer must be a whole number from ${question.min} to ${question.max}.`
  }
  if (question.type !== 'number') return null
  if (question.min !== undefined && value < question.min) {
    return `the preset answer must be at least ${question.min}.`
  }
  if (question.max !== undefined && value > question.max) {
    return `the preset answer must be at most ${question.max}.`
  }
  return null
}

const buildPreset = (
  draft: QuestionDraft,
  question: CheckInQuestion,
  label: string,
): Built<CheckInAnswerValue | undefined> => {
  const typed = draft.preset.trim()
  if (typed === '') return { errors: [], value: undefined }
  switch (question.type) {
    case 'number':
    case 'scale': {
      const value = parseNumber(typed) ?? NaN
      const problem = numberPresetProblem(question, value)
      return problem ? { errors: [`${label}: ${problem}`], value: undefined } : { errors: [], value }
    }
    case 'yes_no':
      return { errors: [], value: typed === 'yes' }
    case 'choice': {
      const option = question.options[Number(typed)]
      return { errors: [], value: option?.key }
    }
    case 'multi_choice': {
      const keys = presetIndexes(typed).flatMap((index) => {
        const option = question.options[index]
        return option ? [option.key] : []
      })
      return { errors: [], value: keys.length > 0 ? keys : undefined }
    }
    case 'text':
      return { errors: [], value: typed }
  }
}

const buildQuestion = (question: QuestionDraft, index: number, key: string): Built<CheckInQuestion> => {
  const label = `Question ${index + 1}`
  const errors: string[] = []
  const prompt = question.prompt.trim()
  if (prompt === '') errors.push(`${label}: write the question.`)
  const logsTo = buildLogsTo(question, label)
  const base: QuestionBase = {
    key,
    prompt,
    required: question.required,
    ...(logsTo.value ? { logs_to: logsTo.value } : {}),
  }
  const built = buildTyped(question, label, base)
  const preset = buildPreset(question, built.value, label)
  return {
    errors: [...errors, ...logsTo.errors, ...built.errors, ...preset.errors],
    value: preset.value === undefined ? built.value : { ...built.value, default: preset.value },
  }
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

export type IntakeKind = 'medication' | 'supplement'

export interface IntakeDraft {
  substance: string
  dose: string
  unit: string
  kind: IntakeKind
  log_as: LogAs
}

export const emptyIntakeDraft = (kind: IntakeKind = 'supplement'): IntakeDraft => ({
  dose: '',
  kind,
  log_as: 'activity',
  substance: '',
  unit: 'mg',
})

const asciiSlug = (from: string): string =>
  from
    .replaceAll(/[µμ]/g, 'u')
    .normalize('NFKD')
    .replaceAll(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')

/** "Ibuprofen" and "mg" make `ibuprofen_mg`, "Vitamin D" and "µg" make `vitamin_d_ug`; a valid metric name. */
export const metricNameForDose = (substance: string, unit: string): string => {
  const name = [asciiSlug(substance), asciiSlug(unit)].filter(Boolean).join('_')
  const lettered = /^[a-z]/.test(name) ? name : `dose_${name}`.replace(/_+$/, '')
  return lettered.slice(0, 50).replace(/_+$/, '')
}

const capitalized = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

/** What is missing from the shortcut's answers, in plain words; empty when the question can be made. */
export const intakeProblems = (intake: IntakeDraft): string[] => {
  const problems: string[] = []
  if (intake.substance.trim() === '') problems.push('Name the medication or supplement.')
  const dose = parseNumber(intake.dose)
  const doseOk = dose !== undefined && !Number.isNaN(dose) && dose > 0
  if (!doseOk) problems.push('Give the dose as a number above 0.')
  if (intake.unit.trim() === '') problems.push('Give the unit of the dose.')
  return problems
}

/**
 * The question the "Add medication or supplement" shortcut makes: a number question preset to the dose,
 * logged as the dose metric of the substance or as a `medication` / `supplement` activity.
 */
export const intakeQuestion = (intake: IntakeDraft): QuestionDraft => {
  const substance = intake.substance.trim()
  const unit = intake.unit.trim()
  const dose = String(parseNumber(intake.dose) ?? '')
  const base: QuestionDraft = {
    ...newQuestion('number'),
    logs: true,
    min: '0',
    preset: dose,
    prompt: capitalized(substance),
    unit,
  }
  if (intake.log_as === 'metric') {
    return { ...base, log_as: 'metric', metric: metricNameForDose(substance, unit) }
  }
  return {
    ...base,
    activity_fields: [
      { kind: 'string', name: 'substance', value: substance },
      { kind: 'string', name: 'dose_unit', value: unit },
    ],
    activity_type: intake.kind,
    answer_field: 'dose',
    log_as: 'activity',
  }
}

/** Whether the question is the untouched one a new form starts with, which the shortcut replaces. */
export const isBlankQuestion = (question: QuestionDraft): boolean =>
  question.key === null && question.prompt.trim() === '' && !question.logs && question.preset.trim() === ''
