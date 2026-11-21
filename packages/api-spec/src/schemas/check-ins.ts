import { z } from 'zod'

import {
  baseResponseSchema,
  dateOnlySchema,
  iso8601DateTimeSchema,
  queryBooleanSchema,
  UUID_RE,
} from './common.ts'
import { scheduleSchema } from './schedules.ts'

export const CHECK_IN_QUESTIONS_MAX = 40
export const CHECK_IN_OPTIONS_MIN = 2
export const CHECK_IN_OPTIONS_MAX = 20
export const CHECK_IN_SCALE_STEPS_MAX = 11
export const CHECK_IN_FORM_NAME_MAX = 120
export const CHECK_IN_FORM_DESCRIPTION_MAX = 1000
export const CHECK_IN_PROMPT_MAX = 300
export const CHECK_IN_TEXT_ANSWER_MAX = 2000
export const CHECK_IN_NOTE_MAX = 2000

export const checkInQuestionKeyRe = /^[a-z][a-z0-9_]{0,39}$/

/** The key a form's score is recorded under in a check-in's `logged`; no question key can take it. */
export const CHECK_IN_SCORE_KEY = '_score'

const keySchema = z
  .string()
  .regex(checkInQuestionKeyRe, 'Must be lowercase letters, digits and underscores, starting with a letter')

const metricNameSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z][a-z0-9_]*$/, 'Must be lowercase letters, numbers, and underscores, starting with a letter')
  .meta({
    description:
      'A built-in metric, a custom metric, or a metric catalogue name; any other name is added as a custom metric on first use',
    example: 'rested',
  })

const activityTypeNameSchema = z.string().min(1).max(100).meta({
  description:
    'An activity type of yours, or a built-in catalogue type (e.g. `medication`, `supplement`) added on first use',
  example: 'supplement',
})

const activityFieldNameSchema = z.string().min(1).max(100)

export const checkInLogsToSchema = z
  .object({
    activity_type: activityTypeNameSchema.optional(),
    answer_field: activityFieldNameSchema.optional().meta({
      description:
        'Activity logging, `number` and `scale` only: the field of the activity the answer is written to, e.g. `dose`',
      example: 'dose',
    }),
    fields: z
      .record(activityFieldNameSchema, z.union([z.string().max(200), z.number(), z.boolean()]))
      .optional()
      .meta({
        description:
          'Activity logging: the fixed fields of the activity, e.g. `{ "substance": "vitamin D" }`',
      }),
    metric: metricNameSchema.optional(),
  })
  .superRefine((logsTo, ctx) => {
    if ((logsTo.metric === undefined) === (logsTo.activity_type === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Give either metric or activity_type', path: ['metric'] })
    }
    if (logsTo.metric !== undefined && (logsTo.fields !== undefined || logsTo.answer_field !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'fields and answer_field go with activity_type',
        path: ['fields'],
      })
    }
  })
  .meta({
    description:
      'Where an answer is logged, one of: `{ metric }`, one point of the metric at the check-in time (yes as 1, no as 0); or `{ activity_type, fields?, answer_field? }`, an activity of that type at the check-in time with `fields` as its data and the answer in `answer_field`. Data source `check_in`. An answer of 0, no, or none logs nothing.',
    id: 'CheckInLogsTo',
  })

export type CheckInLogsTo = z.infer<typeof checkInLogsToSchema>

export const checkInOptionSchema = z
  .object({
    key: keySchema.meta({ description: 'Stable key of the option, the answer to a choice question' }),
    label: z.string().trim().min(1).max(100).meta({ description: 'Text shown for the option' }),
    value: z.number().optional().meta({ description: 'Numeric value of the option, logged and scored' }),
  })
  .meta({ id: 'CheckInOption' })

export type CheckInOption = z.infer<typeof checkInOptionSchema>

export const checkInAnswerValueSchema = z
  .union([
    z.number(),
    z.boolean(),
    z.string().max(CHECK_IN_TEXT_ANSWER_MAX),
    z.array(z.string().max(40)).max(CHECK_IN_OPTIONS_MAX),
  ])
  .meta({
    description:
      'A number (`number`, `scale`), a boolean (`yes_no`), an option key (`choice`), option keys (`multi_choice`) or text (`text`)',
    id: 'CheckInAnswerValue',
  })

export type CheckInAnswerValue = z.infer<typeof checkInAnswerValueSchema>

const questionBase = {
  default: checkInAnswerValueSchema.optional().meta({
    description:
      'The preset answer, valid for the question type. A form whose required questions all have one (and that has at least one) is a routine, saved as preset in one tap.',
  }),
  key: keySchema.meta({
    description:
      'Stable key the answer is stored under; a key removed from a form is not reused with another type',
    example: 'rested',
  }),
  logs_to: checkInLogsToSchema.optional(),
  prompt: z.string().trim().min(1).max(CHECK_IN_PROMPT_MAX).meta({ description: 'The question asked' }),
  required: z.boolean().default(false).meta({ description: 'Whether an answer is required (default false)' }),
}

const optionsSchema = z.array(checkInOptionSchema).min(CHECK_IN_OPTIONS_MIN).max(CHECK_IN_OPTIONS_MAX)

export const checkInQuestionSchema = z
  .discriminatedUnion('type', [
    z.object({
      ...questionBase,
      max: z.number().optional().meta({ description: 'Largest accepted answer' }),
      min: z.number().optional().meta({ description: 'Smallest accepted answer' }),
      step: z.number().positive().optional().meta({ description: 'Step the input offers' }),
      type: z.literal('number'),
      unit: z.string().trim().min(1).max(20).optional().meta({ description: 'Unit of the answer, e.g. mg' }),
    }),
    z.object({
      ...questionBase,
      max: z.number().int().meta({ description: 'Highest point of the scale' }),
      max_label: z.string().trim().max(60).optional().meta({ description: 'Label of the highest point' }),
      min: z.number().int().meta({ description: 'Lowest point of the scale' }),
      min_label: z.string().trim().max(60).optional().meta({ description: 'Label of the lowest point' }),
      type: z.literal('scale'),
    }),
    z.object({ ...questionBase, type: z.literal('yes_no') }),
    z.object({ ...questionBase, options: optionsSchema, type: z.literal('choice') }),
    z.object({ ...questionBase, options: optionsSchema, type: z.literal('multi_choice') }),
    z.object({ ...questionBase, type: z.literal('text') }),
  ])
  .meta({
    description:
      'A question of a check-in form: `number`, `scale` (integers, at most 11 points), `yes_no`, `choice`, `multi_choice` or `text`',
    id: 'CheckInQuestion',
  })

export type CheckInQuestion = z.infer<typeof checkInQuestionSchema>
export type CheckInQuestionType = CheckInQuestion['type']

export const checkInScoreSchema = z
  .object({
    factor: z
      .number()
      .refine((factor) => factor !== 0, 'Must not be 0')
      .optional()
      .meta({ description: 'Multiplies the sum (default 1)', example: 4 }),
    metric: metricNameSchema,
    questions: z
      .array(keySchema)
      .min(1)
      .max(CHECK_IN_QUESTIONS_MAX)
      .meta({ description: 'Keys of the numeric questions whose answers are summed' }),
  })
  .meta({
    description:
      'A score: the sum of some answers times `factor`, logged to `metric`. Absent when one of those answers is missing.',
    id: 'CheckInScore',
  })

export type CheckInScore = z.infer<typeof checkInScoreSchema>

export interface CheckInFormProblem {
  path: (string | number)[]
  message: string
}

export const isNumericCheckInQuestion = (question: CheckInQuestion): boolean =>
  question.type === 'number' ||
  question.type === 'scale' ||
  question.type === 'yes_no' ||
  (question.type === 'choice' && question.options.every((option) => option.value !== undefined))

const logsToProblem = (question: CheckInQuestion): string | null => {
  if (!question.logs_to) return null
  if (question.logs_to.activity_type !== undefined) {
    if (question.type !== 'number' && question.type !== 'scale' && question.type !== 'yes_no') {
      return `A ${question.type} answer cannot be logged as an activity`
    }
    return question.type === 'yes_no' && question.logs_to.answer_field !== undefined
      ? 'A yes/no answer logs the activity on yes and has no answer_field'
      : null
  }
  if (question.type === 'text' || question.type === 'multi_choice') {
    return `A ${question.type} answer cannot be logged to a metric`
  }
  return isNumericCheckInQuestion(question)
    ? null
    : 'A choice logged to a metric needs a numeric value on every option'
}

const questionProblems = (question: CheckInQuestion, index: number): CheckInFormProblem[] => {
  const at = (field: string, message: string): CheckInFormProblem => ({
    message,
    path: ['questions', index, field],
  })
  const problems: CheckInFormProblem[] = []
  if (question.type === 'number' && question.min !== undefined && question.max !== undefined) {
    if (question.min >= question.max) problems.push(at('max', 'max must be above min'))
  }
  if (question.type === 'scale') {
    if (question.min >= question.max) problems.push(at('max', 'max must be above min'))
    else if (question.max - question.min + 1 > CHECK_IN_SCALE_STEPS_MAX) {
      problems.push(at('max', `A scale has at most ${CHECK_IN_SCALE_STEPS_MAX} points`))
    }
  }
  if (question.type === 'choice' || question.type === 'multi_choice') {
    const keys = question.options.map((option) => option.key)
    if (new Set(keys).size !== keys.length) problems.push(at('options', 'Option keys must be unique'))
  }
  const logsTo = logsToProblem(question)
  if (logsTo) problems.push(at('logs_to', logsTo))
  return problems
}

const hasAnswer = (value: CheckInAnswerValue | undefined): boolean =>
  value !== undefined &&
  !(typeof value === 'string' && value.trim() === '') &&
  !(Array.isArray(value) && value.length === 0)

/** A routine: every required question has a preset answer, and at least one question has one. */
export const isCheckInRoutine = (questions: readonly CheckInQuestion[]): boolean =>
  questions.some((question) => hasAnswer(question.default)) &&
  questions.every((question) => !question.required || hasAnswer(question.default))

/** Whether an answer counts as taken: given, and not 0 or no. */
export const isTakenAnswer = (question: CheckInQuestion, value: CheckInAnswerValue | undefined): boolean => {
  if (!hasAnswer(value)) return false
  if (question.type === 'yes_no') return value === true
  if (question.type === 'number' || question.type === 'scale') return typeof value === 'number' && value !== 0
  return true
}

const optionLabel = (question: CheckInQuestion, key: string): string =>
  'options' in question ? (question.options.find((option) => option.key === key)?.label ?? key) : key

/** An answer taken, as an item of a line ("Vitamin D 50 µg"); null when it is not taken. */
export const presetItem = (question: CheckInQuestion, value: CheckInAnswerValue): string | null => {
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

/** A routine's preset items in a line: "Vitamin D 50 µg, Magnesium 200 mg". */
export const presetLine = (questions: readonly CheckInQuestion[]): string =>
  questions
    .flatMap((question) => {
      if (question.default === undefined) return []
      const item = presetItem(question, question.default)
      return item ? [item] : []
    })
    .join(', ')

const scoreProblems = (questions: readonly CheckInQuestion[], score: CheckInScore): CheckInFormProblem[] => {
  const byKey = new Map(questions.map((question) => [question.key, question]))
  const problems: CheckInFormProblem[] = []
  if (new Set(score.questions).size !== score.questions.length) {
    problems.push({ message: 'Score questions must be unique', path: ['score', 'questions'] })
  }
  score.questions.forEach((key, index) => {
    const question = byKey.get(key)
    if (!question) {
      problems.push({ message: `No question "${key}"`, path: ['score', 'questions', index] })
    } else if (!isNumericCheckInQuestion(question)) {
      problems.push({
        message: `Question "${key}" has no numeric answer to score`,
        path: ['score', 'questions', index],
      })
    }
  })
  return problems
}

/** What is wrong with a form's questions and score taken together; empty when nothing is. */
export const checkInFormProblems = (
  questions: readonly CheckInQuestion[],
  score: CheckInScore | null | undefined,
): CheckInFormProblem[] => {
  const problems: CheckInFormProblem[] = []
  const seen = new Set<string>()
  questions.forEach((question, index) => {
    if (seen.has(question.key)) {
      problems.push({
        message: `Duplicate question key "${question.key}"`,
        path: ['questions', index, 'key'],
      })
    }
    seen.add(question.key)
    problems.push(...questionProblems(question, index))
  })
  const metrics = new Set<string>()
  const logged = [
    ...questions.flatMap((question, index) =>
      question.logs_to?.metric !== undefined
        ? [{ metric: question.logs_to.metric, path: ['questions', index, 'logs_to'] }]
        : [],
    ),
    ...(score ? [{ metric: score.metric, path: ['score', 'metric'] }] : []),
  ]
  for (const { metric, path } of logged) {
    if (metrics.has(metric)) {
      problems.push({ message: `Metric "${metric}" is logged twice by this form`, path })
    }
    metrics.add(metric)
  }
  if (score) problems.push(...scoreProblems(questions, score))
  return problems
}

const questionsSchema = z
  .array(checkInQuestionSchema)
  .min(1)
  .max(CHECK_IN_QUESTIONS_MAX)
  .meta({
    description: `The questions, in the order they are asked (1 to ${CHECK_IN_QUESTIONS_MAX})`,
  })

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(CHECK_IN_FORM_NAME_MAX)
  .meta({ description: 'Name of the form, also the title of its due notification' })

const descriptionSchema = z
  .string()
  .max(CHECK_IN_FORM_DESCRIPTION_MAX)
  .meta({ description: 'Text shown above the questions' })

const reportProblems = (
  questions: readonly CheckInQuestion[] | undefined,
  score: CheckInScore | null | undefined,
  ctx: z.RefinementCtx,
): void => {
  if (!questions) return
  for (const problem of checkInFormProblems(questions, score)) {
    ctx.addIssue({ code: 'custom', message: problem.message, path: problem.path })
  }
}

export const checkInFormSchema = z
  .object({
    archived: z.boolean().meta({ description: 'An archived form is kept but asks for nothing' }),
    created_at: iso8601DateTimeSchema,
    deleted_at: iso8601DateTimeSchema.nullable().meta({ description: 'When it was deleted; null when live' }),
    description: z.string().nullable(),
    id: z.string().uuid().meta({ description: 'Form ID' }),
    is_routine: z.boolean().meta({
      description:
        'Whether the form is a routine: every required question has a `default` (and at least one question has one), so `use_defaults` saves it in one tap. A routine without a schedule is an as-needed favourite.',
    }),
    name: z.string(),
    notify: z.boolean().meta({ description: 'Whether a due slot raises a `check_in_due` notification' }),
    questions: z.array(checkInQuestionSchema),
    schedule: scheduleSchema.nullable().meta({ description: 'When the form is asked for; null for none' }),
    score: checkInScoreSchema.nullable(),
    updated_at: iso8601DateTimeSchema,
    version: z
      .number()
      .int()
      .meta({ description: 'Current version; it moves when a question or the score changes in substance' }),
  })
  .meta({ description: 'A check-in form the user built or copied from a template', id: 'CheckInForm' })

export type CheckInForm = z.infer<typeof checkInFormSchema>

export const addCheckInFormBodySchema = z
  .object({
    description: descriptionSchema.optional(),
    name: nameSchema.optional(),
    notify: z
      .boolean()
      .default(true)
      .meta({ description: 'Raise a `check_in_due` notification when a slot is due (default true)' }),
    questions: questionsSchema.optional(),
    schedule: scheduleSchema.optional(),
    score: checkInScoreSchema.optional(),
    template: z
      .string()
      .optional()
      .meta({ description: 'ID of a built-in template to copy; the other fields override its own' }),
  })
  .superRefine((body, ctx) => {
    if (body.template === undefined) {
      if (body.name === undefined) {
        ctx.addIssue({ code: 'custom', message: 'Give a name or a template', path: ['name'] })
      }
      if (body.questions === undefined) {
        ctx.addIssue({ code: 'custom', message: 'Give questions or a template', path: ['questions'] })
      }
    }
    reportProblems(body.questions, body.score, ctx)
  })
  .meta({
    description: 'A new check-in form, built from scratch or copied from a template',
    id: 'AddCheckInFormBody',
  })

export type AddCheckInFormBody = z.infer<typeof addCheckInFormBodySchema>

export const updateCheckInFormBodySchema = z
  .object({
    archived: z.boolean().optional().meta({ description: 'Archive or unarchive the form' }),
    description: descriptionSchema.nullable().optional().meta({ description: 'New text; null clears it' }),
    name: nameSchema.optional(),
    notify: z.boolean().optional(),
    questions: questionsSchema.optional(),
    schedule: scheduleSchema.nullable().optional().meta({ description: 'New schedule; null removes it' }),
    score: checkInScoreSchema.nullable().optional().meta({ description: 'New score; null removes it' }),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Give at least one field to change',
    path: ['name'],
  })
  .superRefine((body, ctx) => reportProblems(body.questions, body.score, ctx))
  .meta({
    description:
      'Fields of a check-in form to change; at least one. `questions` replaces them all. A change to a question (other than its place) or to the score makes a new version.',
    id: 'UpdateCheckInFormBody',
  })

export type UpdateCheckInFormBody = z.infer<typeof updateCheckInFormBodySchema>

export const checkInFormsQuerySchema = z
  .object({
    deleted: queryBooleanSchema
      .optional()
      .meta({ description: 'List the deleted forms (restorable for 30 days) instead of the live ones' }),
  })
  .meta({ id: 'CheckInFormsQuery' })

export type CheckInFormsQuery = z.infer<typeof checkInFormsQuerySchema>

export const checkInFormsResponseSchema = baseResponseSchema
  .extend({ forms: z.array(checkInFormSchema) })
  .meta({ id: 'CheckInFormsResponse' })

export type CheckInFormsResponse = z.infer<typeof checkInFormsResponseSchema>

export const checkInFormResponseSchema = baseResponseSchema
  .extend({ form: checkInFormSchema.optional() })
  .meta({ id: 'CheckInFormResponse' })

export type CheckInFormResponse = z.infer<typeof checkInFormResponseSchema>

export const checkInTemplateSchema = z
  .object({
    description: z.string(),
    id: z.string().meta({ description: 'Template ID, given as `template` to copy it', example: 'morning' }),
    licence: z.string().meta({ description: 'Terms the instrument may be used under' }),
    name: z.string(),
    questions: z.array(checkInQuestionSchema),
    score: checkInScoreSchema.nullable(),
    source: z.string().meta({ description: 'Where the instrument comes from' }),
  })
  .meta({ description: 'A built-in check-in form the user can copy and then edit', id: 'CheckInTemplate' })

export type CheckInTemplate = z.infer<typeof checkInTemplateSchema>

export const checkInTemplatesResponseSchema = baseResponseSchema
  .extend({ templates: z.array(checkInTemplateSchema) })
  .meta({ id: 'CheckInTemplatesResponse' })

export type CheckInTemplatesResponse = z.infer<typeof checkInTemplatesResponseSchema>

const answersSchema = z
  .record(z.string(), checkInAnswerValueSchema)
  .refine((answers) => Object.keys(answers).length <= CHECK_IN_QUESTIONS_MAX, 'Too many answers')
  .meta({ description: 'Answers keyed by question key; a question left out is unanswered' })

export const checkInLoggedSchema = z
  .object({ metric: z.string(), time: iso8601DateTimeSchema })
  .meta({ description: 'A metric point a check-in wrote', id: 'CheckInLogged' })

export const checkInStatuses = ['answered', 'skipped'] as const

export type CheckInStatus = (typeof checkInStatuses)[number]

export const checkInEntityTypes = ['activity'] as const

export const checkInActivitySchema = z
  .object({
    activity_id: z.string().uuid(),
    logged: z.boolean().meta({ description: 'False once the activity was deleted on its own' }),
  })
  .meta({ description: 'An activity a check-in answer logged', id: 'CheckInActivity' })

export type CheckInActivity = z.infer<typeof checkInActivitySchema>

export const checkInSchema = z
  .object({
    activities: z.record(z.string(), checkInActivitySchema).meta({
      description: 'The activities this check-in logged, by question key',
    }),
    answered_at: iso8601DateTimeSchema.meta({ description: 'When it was answered, or the skip recorded' }),
    answers: z.record(z.string(), checkInAnswerValueSchema),
    created_at: iso8601DateTimeSchema,
    deleted_at: iso8601DateTimeSchema.nullable().meta({ description: 'When it was deleted; null when live' }),
    entity_id: z.string().nullable().meta({ description: 'ID of the entity the check-in is tied to' }),
    entity_type: z
      .enum(checkInEntityTypes)
      .nullable()
      .meta({ description: 'Kind of entity the check-in is tied to, if any' }),
    form_id: z.string().uuid(),
    form_name: z.string().meta({ description: "The form's current name" }),
    form_version: z.number().int().meta({ description: 'The form version answered' }),
    id: z.string().uuid().meta({ description: 'Check-in ID' }),
    log_errors: z
      .array(z.object({ error: z.string(), question_key: z.string() }))
      .optional()
      .meta({ description: 'Answers that could not be logged by this write, if any' }),
    logged: z.record(z.string(), checkInLoggedSchema).meta({
      description: `The metric points this check-in wrote, by question key (the score under \`${CHECK_IN_SCORE_KEY}\`)`,
    }),
    note: z.string().nullable(),
    questions: z
      .array(checkInQuestionSchema)
      .meta({ description: 'The questions of the form version answered, to read the answers against' }),
    scheduled_for: iso8601DateTimeSchema
      .nullable()
      .meta({ description: 'The schedule slot this check-in answers, if any' }),
    score: z
      .number()
      .nullable()
      .meta({ description: "The form version's score, if it has one and it is complete" }),
    status: z.enum(checkInStatuses).meta({
      description: '`answered`, or `skipped`: a slot recorded as skipped, with no answers',
    }),
    updated_at: iso8601DateTimeSchema,
  })
  .meta({ description: 'A filled-in check-in form, or a skipped slot', id: 'CheckIn' })

export type CheckIn = z.infer<typeof checkInSchema>

export const submitCheckInBodySchema = z
  .object({
    answered_at: iso8601DateTimeSchema.optional().meta({ description: 'When it was answered (default now)' }),
    answers: answersSchema.default({}),
    entity_id: z
      .string()
      .regex(UUID_RE, 'Must be an ID')
      .optional()
      .meta({ description: 'ID of the entity to tie the check-in to: a live activity' }),
    entity_type: z
      .enum(checkInEntityTypes)
      .optional()
      .meta({ description: 'Kind of entity to tie the check-in to (with `entity_id`)' }),
    form_id: z.string().regex(UUID_RE, 'Must be a form ID').meta({ description: 'The form answered' }),
    note: z.string().max(CHECK_IN_NOTE_MAX).optional().meta({ description: 'A note on the check-in' }),
    scheduled_for: iso8601DateTimeSchema
      .optional()
      .meta({ description: 'The schedule slot answered (its `scheduled_for` from GET /due)' }),
    status: z.enum(checkInStatuses).optional().meta({
      description:
        '`skipped` records the slot `scheduled_for` as skipped: no answers, nothing logged (default `answered`)',
    }),
    use_defaults: z.boolean().optional().meta({
      description:
        "Save the preset answer of every question that has one; `answers` given alongside win per key. Only for a routine (the form's `is_routine`).",
    }),
  })
  .superRefine((body, ctx) => {
    if ((body.entity_type === undefined) !== (body.entity_id === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Give entity_type and entity_id together',
        path: ['entity_id'],
      })
    }
    if (body.status !== 'skipped') return
    if (body.scheduled_for === undefined) {
      ctx.addIssue({ code: 'custom', message: 'A skip needs scheduled_for', path: ['scheduled_for'] })
    }
    if (Object.keys(body.answers).length > 0 || body.use_defaults === true) {
      ctx.addIssue({ code: 'custom', message: 'A skip has no answers', path: ['answers'] })
    }
  })
  .meta({
    description: "A check-in: answers to the form's current version, or a skipped slot",
    id: 'SubmitCheckInBody',
  })

export type SubmitCheckInBody = z.infer<typeof submitCheckInBodySchema>

export const updateCheckInBodySchema = z
  .object({
    answered_at: iso8601DateTimeSchema.optional(),
    answers: answersSchema.optional().meta({ description: 'New answers, replacing them all' }),
    note: z
      .string()
      .max(CHECK_IN_NOTE_MAX)
      .nullable()
      .optional()
      .meta({ description: 'New note; null clears it' }),
    scheduled_for: iso8601DateTimeSchema
      .nullable()
      .optional()
      .meta({ description: 'New slot; null clears it' }),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Give at least one field to change',
    path: ['answers'],
  })
  .meta({
    description:
      'Fields of a check-in to change; at least one. Answers are read against the version it answered, and its logged points are replaced.',
    id: 'UpdateCheckInBody',
  })

export type UpdateCheckInBody = z.infer<typeof updateCheckInBodySchema>

export const checkInsQuerySchema = z
  .object({
    cursor: z.string().optional().meta({ description: '`next_cursor` of the previous page' }),
    deleted: queryBooleanSchema
      .optional()
      .meta({ description: 'List the deleted check-ins (restorable for 30 days) instead of the live ones' }),
    entity_id: z
      .string()
      .regex(UUID_RE, 'Must be an ID')
      .optional()
      .meta({ description: 'Only those tied to this entity (with `entity_type`)' }),
    entity_type: z
      .enum(checkInEntityTypes)
      .optional()
      .meta({ description: 'Only those tied to this kind of entity' }),
    form_id: z
      .string()
      .regex(UUID_RE, 'Must be a form ID')
      .optional()
      .meta({ description: 'Only this form' }),
    from: iso8601DateTimeSchema.optional().meta({ description: 'Answered at or after this time' }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .meta({ description: 'Max check-ins to return (1–200, default 50)' }),
    to: iso8601DateTimeSchema.optional().meta({ description: 'Answered before this time' }),
  })
  .refine((query) => (query.entity_type === undefined) === (query.entity_id === undefined), {
    message: 'Give entity_type and entity_id together',
    path: ['entity_id'],
  })
  .meta({ id: 'CheckInsQuery' })

export type CheckInsQuery = z.infer<typeof checkInsQuerySchema>

export const checkInsResponseSchema = baseResponseSchema
  .extend({
    check_ins: z.array(checkInSchema).meta({ description: 'Newest first' }),
    next_cursor: z.string().nullable().meta({ description: 'Cursor for the next page, or null on the last' }),
  })
  .meta({ id: 'CheckInsResponse' })

export type CheckInsResponse = z.infer<typeof checkInsResponseSchema>

export const checkInResponseSchema = baseResponseSchema
  .extend({ check_in: checkInSchema.optional() })
  .meta({ id: 'CheckInResponse' })

export type CheckInResponse = z.infer<typeof checkInResponseSchema>

export const dueSlotStates = ['due', 'upcoming', 'done', 'skipped', 'missed'] as const

export type DueSlotState = (typeof dueSlotStates)[number]

export const dueSlotSchema = z
  .object({
    check_in_id: z
      .string()
      .uuid()
      .nullable()
      .meta({ description: 'The check-in that did or skipped it, when done or skipped' }),
    date: dateOnlySchema.meta({
      description: "The day the slot belongs to (by the schedule's `day_starts_at`)",
    }),
    form_id: z.string().uuid(),
    form_name: z.string(),
    scheduled_for: iso8601DateTimeSchema.meta({ description: 'The instant of the slot' }),
    state: z.enum(dueSlotStates).meta({
      description:
        '`upcoming` before its time, `due` after it, `done` once answered, `skipped` once recorded as skipped, `missed` once its day is over',
    }),
    time: z.string().meta({ description: 'Local time of the slot (HH:MM)', example: '08:00' }),
  })
  .meta({ description: 'A slot of a scheduled check-in form', id: 'DueSlot' })

export type DueSlot = z.infer<typeof dueSlotSchema>

export const dueQuerySchema = z
  .object({
    date: dateOnlySchema
      .optional()
      .meta({ description: "The day (YYYY-MM-DD); default each form's current day" }),
  })
  .meta({ id: 'DueQuery' })

export type DueQuery = z.infer<typeof dueQuerySchema>

export const dueResponseSchema = baseResponseSchema
  .extend({
    slots: z.array(dueSlotSchema).meta({ description: 'In time order' }),
    timezone: z
      .string()
      .meta({ description: 'The time zone the slots are read in', example: 'Europe/Stockholm' }),
  })
  .meta({ id: 'DueResponse' })

export type DueResponse = z.infer<typeof dueResponseSchema>

export const CHECK_IN_ADHERENCE_DAYS_MAX = 366
export const CHECK_IN_ADHERENCE_DAYS_DEFAULT = 30

export const checkInAdherenceQuerySchema = z
  .object({
    from: dateOnlySchema
      .optional()
      .meta({ description: 'First day (YYYY-MM-DD); default 29 days before `to`' }),
    to: dateOnlySchema
      .optional()
      .meta({ description: "Last day (YYYY-MM-DD); default the form's current day" }),
  })
  .meta({ id: 'CheckInAdherenceQuery' })

export type CheckInAdherenceQuery = z.infer<typeof checkInAdherenceQuerySchema>

const adherenceCountsShape = {
  done: z.number().int().meta({ description: 'Slots answered' }),
  missed: z.number().int().meta({ description: 'Slots whose day ended without a check-in' }),
  skipped: z.number().int().meta({ description: 'Slots recorded as skipped' }),
  upcoming: z.number().int().meta({ description: "Today's slots still open" }),
}

export const checkInAdherenceDaySchema = z
  .object({ date: dateOnlySchema, ...adherenceCountsShape })
  .meta({ description: "One day's slots of a form, counted by state", id: 'CheckInAdherenceDay' })

export type CheckInAdherenceDay = z.infer<typeof checkInAdherenceDaySchema>

export const checkInAdherenceQuestionSchema = z
  .object({
    answered: z.number().int().meta({
      description:
        'Answered check-ins with an answer to it other than 0 or no: for a routine, how often the item was taken',
    }),
    key: z.string(),
    prompt: z.string().meta({ description: "The question's prompt in the form's current version" }),
  })
  .meta({ description: 'How often a question was answered', id: 'CheckInAdherenceQuestion' })

export const checkInAdherenceSchema = z
  .object({
    answered_check_ins: z
      .number()
      .int()
      .meta({ description: 'The answered check-ins of the form in the window (scheduled or not)' }),
    days: z.array(checkInAdherenceDaySchema).meta({ description: 'Each day of the window, in order' }),
    form_id: z.string().uuid(),
    from: dateOnlySchema,
    questions: z
      .array(checkInAdherenceQuestionSchema)
      .meta({ description: "The current version's questions, in order" }),
    timezone: z
      .string()
      .meta({ description: 'The time zone the days are read in', example: 'Europe/Stockholm' }),
    to: dateOnlySchema,
    totals: z.object(adherenceCountsShape).meta({ description: 'The slots of the whole window by state' }),
  })
  .meta({
    description:
      "How a form was kept up over a window of days: its slots by state (read against the form's current schedule) and how often each question was answered",
    id: 'CheckInAdherence',
  })

export type CheckInAdherence = z.infer<typeof checkInAdherenceSchema>

export const checkInAdherenceResponseSchema = baseResponseSchema
  .extend({ adherence: checkInAdherenceSchema.optional() })
  .meta({ id: 'CheckInAdherenceResponse' })

export type CheckInAdherenceResponse = z.infer<typeof checkInAdherenceResponseSchema>
