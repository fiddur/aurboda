import type {
  AddCheckInFormBody,
  CheckIn,
  CheckInAnswerValue,
  CheckInForm,
  CheckInQuestion,
  CheckInScore,
  CheckInsQuery,
  CheckInsResponse,
  CheckInTemplate,
  CustomMetricDefinition,
  DueSlot,
  DueResponse,
  StoredMetricCatalog,
  SubmitCheckInBody,
  UpdateCheckInBody,
  UpdateCheckInFormBody,
} from '@aurboda/api-spec'

import { checkInFormProblems, UUID_RE } from '@aurboda/api-spec'

import type { BulkAddMetricsResult, BulkMetricItem } from './mutations.ts'

import {
  type CheckInFormInsert,
  type CheckInFormPatch,
  type CheckInFormRecord,
  type CheckInFormVersionRecord,
  type CheckInInsert,
  type CheckInLoggedPoint,
  type CheckInPatch,
  type CheckInRecord,
  deleteCheckInPoints,
  getCheckIn,
  getCheckInForm,
  getSourceFilter,
  insertCheckIn,
  insertCheckInForm,
  listCheckInForms,
  listCheckInFormVersions,
  listCheckIns,
  type ListCheckInsOptions,
  listFormCheckInsBetween,
  markCheckInDueNotificationsRead,
  restoreCheckInForm,
  setCheckInDeleted,
  type SlotCheckInRecord,
  softDeleteCheckInForm,
  updateCheckIn,
  updateCheckInForm,
} from '../db/index.ts'
import {
  answerProblems,
  definitionChanged,
  metricPointsFor,
  reusedKeyProblems,
  scoreOf,
} from './check-in-definitions.ts'
import { checkInTemplates, findCheckInTemplate } from './check-in-templates.ts'
import { addCustomMetric, getCustomMetrics } from './custom-metrics.ts'
import { currentDay, type ScheduleSlot, slotsForDay, slotStates } from './due-items.ts'
import { decodeKeysetCursor, encodeKeysetCursor } from './keyset-cursor.ts'
import { loadMetricCatalog } from './metric-catalog.ts'
import { resolveMetricForWrite, valueForWrite } from './metric-resolution.ts'
import { bulkAddMetrics } from './mutations.ts'
import { type Notifier, notifier } from './notifications.ts'
import { getUserTimezone } from './settings.ts'

const DUE_WINDOW_MS = 60 * 60 * 1000

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 404; error: string }

const ok = <T>(value: T): Outcome<T> => ({ ok: true, value })
const fail = <T>(status: 400 | 404, error: string): Outcome<T> => ({ error, ok: false, status })

export interface CheckInDeps {
  listForms: (user: string, options: { deleted?: boolean }) => Promise<CheckInFormRecord[]>
  getForm: (user: string, id: string) => Promise<CheckInFormRecord | null>
  insertForm: (user: string, input: CheckInFormInsert) => Promise<CheckInFormRecord>
  updateForm: (
    user: string,
    id: string,
    patch: CheckInFormPatch,
    options: { newVersion: boolean },
  ) => Promise<CheckInFormRecord | null>
  softDeleteForm: (user: string, id: string) => Promise<CheckInFormRecord | null>
  restoreForm: (user: string, id: string, scheduleNotBefore: Date) => Promise<CheckInFormRecord | null>
  listVersions: (user: string, formId: string) => Promise<CheckInFormVersionRecord[]>
  getCheckIn: (user: string, id: string) => Promise<CheckInRecord | null>
  insertCheckIn: (user: string, input: CheckInInsert) => Promise<CheckInRecord>
  listCheckIns: (
    user: string,
    options: ListCheckInsOptions,
  ) => Promise<(CheckInRecord & { cursor_ts: string })[]>
  updateCheckIn: (user: string, id: string, patch: CheckInPatch) => Promise<CheckInRecord | null>
  setCheckInDeleted: (user: string, id: string, deleted: boolean) => Promise<boolean>
  listFormCheckInsBetween: (
    user: string,
    formId: string,
    from: Date,
    to: Date,
  ) => Promise<SlotCheckInRecord[]>
  deletePoints: (user: string, points: readonly CheckInLoggedPoint[]) => Promise<unknown>
  writePoints: (user: string, items: BulkMetricItem[]) => Promise<BulkAddMetricsResult>
  getCustomMetrics: (user: string) => Promise<CustomMetricDefinition[]>
  createMetric: (user: string, definition: CustomMetricDefinition) => Promise<unknown>
  catalog: () => StoredMetricCatalog
  markDueRead: (user: string, formId: string, scheduledFor: readonly string[]) => Promise<unknown>
  raise: Notifier['raiseBestEffort']
  getTimezone: (user: string) => Promise<string>
  now: () => Date
}

/** Resolved at call time, so importing this module never touches the db module's bindings. */
export const checkInDeps: CheckInDeps = {
  catalog: () => loadMetricCatalog(),
  createMetric: (user, definition) => addCustomMetric(user, { ...definition, separate_metric: true }),
  deletePoints: (user, points) => deleteCheckInPoints(user, points),
  getCheckIn: (user, id) => getCheckIn(user, id),
  getCustomMetrics: (user) => getCustomMetrics(user),
  getForm: (user, id) => getCheckInForm(user, id),
  getTimezone: (user) => getUserTimezone(user),
  insertCheckIn: (user, input) => insertCheckIn(user, input),
  insertForm: (user, input) => insertCheckInForm(user, input),
  listCheckIns: (user, options) => listCheckIns(user, options),
  listFormCheckInsBetween: (user, formId, from, to) => listFormCheckInsBetween(user, formId, from, to),
  listForms: (user, options) => listCheckInForms(user, options),
  listVersions: (user, formId) => listCheckInFormVersions(user, formId),
  markDueRead: (user, formId, scheduledFor) => markCheckInDueNotificationsRead(user, formId, scheduledFor),
  now: () => new Date(),
  raise: (user, input) => notifier.raiseBestEffort(user, input),
  restoreForm: (user, id, notBefore) => restoreCheckInForm(user, id, notBefore),
  setCheckInDeleted: (user, id, deleted) => setCheckInDeleted(user, id, deleted),
  softDeleteForm: (user, id) => softDeleteCheckInForm(user, id),
  updateCheckIn: (user, id, patch) => updateCheckIn(user, id, patch),
  updateForm: (user, id, patch, options) => updateCheckInForm(user, id, patch, options),
  writePoints: (user, items) => bulkAddMetrics(user, items, 'check_in'),
}

const FORM_NOT_FOUND = 'Check-in form not found'
const CHECK_IN_NOT_FOUND = 'Check-in not found'

export const serializeCheckInForm = (record: CheckInFormRecord): CheckInForm => ({
  archived: record.archived,
  created_at: record.created_at.toISOString(),
  deleted_at: record.deleted_at?.toISOString() ?? null,
  description: record.description,
  id: record.id,
  name: record.name,
  notify: record.notify,
  questions: record.questions,
  schedule: record.schedule,
  score: record.score,
  updated_at: record.updated_at.toISOString(),
  version: record.version,
})

export const serializeCheckIn = (record: CheckInRecord): CheckIn => ({
  answered_at: record.answered_at.toISOString(),
  answers: record.answers,
  created_at: record.created_at.toISOString(),
  deleted_at: record.deleted_at?.toISOString() ?? null,
  form_id: record.form_id,
  form_name: record.form_name,
  form_version: record.form_version,
  id: record.id,
  logged: record.logged,
  note: record.note,
  questions: record.questions,
  scheduled_for: record.scheduled_for?.toISOString() ?? null,
  score: scoreOf(record.questions, record.score_definition, record.answers),
  status: record.status,
  updated_at: record.updated_at.toISOString(),
})

export const listCheckInTemplates = (): readonly CheckInTemplate[] => checkInTemplates

interface MetricTarget {
  label: string
  metric: string
  unit?: string
}

const metricTargets = (questions: readonly CheckInQuestion[], score: CheckInScore | null): MetricTarget[] => [
  ...questions.flatMap((question) =>
    question.logs_to
      ? [
          {
            label: `"${question.key}"`,
            metric: question.logs_to.metric,
            ...(question.type === 'number' && question.unit ? { unit: question.unit } : {}),
          },
        ]
      : [],
  ),
  ...(score ? [{ label: 'The score', metric: score.metric }] : []),
]

/**
 * A metric an answer logs to must take points from a check-in in the question's unit. A name that
 * is not a metric yet is fine: it becomes a custom metric on first use.
 */
export const metricTargetProblems = (
  questions: readonly CheckInQuestion[],
  score: CheckInScore | null,
  customMetrics: readonly CustomMetricDefinition[],
  catalog: StoredMetricCatalog,
): string[] =>
  metricTargets(questions, score).flatMap(({ label, metric, unit }) => {
    const resolved = resolveMetricForWrite(metric, [...customMetrics], catalog)
    if (!resolved) return []
    if (getSourceFilter(resolved.metric) !== null) {
      return [
        `${label} logs to "${resolved.metric}", which is computed from other sources and cannot be logged`,
      ]
    }
    const converted = valueForWrite(resolved, 1, unit)
    return 'error' in converted ? [`${label}: ${converted.error}`] : []
  })

const definitionProblems = async (
  deps: CheckInDeps,
  user: string,
  questions: readonly CheckInQuestion[],
  score: CheckInScore | null,
): Promise<string | null> => {
  const shape = checkInFormProblems(questions, score).map((problem) => problem.message)
  if (shape.length > 0) return shape.join('; ')
  const targets = metricTargetProblems(questions, score, await deps.getCustomMetrics(user), deps.catalog())
  return targets.length > 0 ? targets.join('; ') : null
}

export const listCheckInFormsView = async (
  deps: CheckInDeps,
  user: string,
  options: { deleted?: boolean } = {},
): Promise<CheckInForm[]> => (await deps.listForms(user, options)).map(serializeCheckInForm)

export const getCheckInFormById = async (
  deps: CheckInDeps,
  user: string,
  id: string,
): Promise<CheckInForm | null> => {
  if (!UUID_RE.test(id)) return null
  const record = await deps.getForm(user, id)
  return record ? serializeCheckInForm(record) : null
}

interface FormDefinition {
  name: string
  description: string | null
  questions: CheckInQuestion[]
  score: CheckInScore | null
}

const definitionFromBody = (body: AddCheckInFormBody): Outcome<FormDefinition> => {
  const template = body.template === undefined ? undefined : findCheckInTemplate(body.template)
  if (body.template !== undefined && !template) {
    return fail(400, `No check-in template "${body.template}"; GET /check-in-templates lists them`)
  }
  const name = body.name ?? template?.name
  const questions = body.questions ?? template?.questions
  if (name === undefined || questions === undefined) {
    return fail(400, 'Give a name and questions, or a template')
  }
  return ok({
    description: blankToNull(body.description ?? template?.description),
    name,
    questions,
    score: body.score ?? template?.score ?? null,
  })
}

export const addCheckInForm = async (
  deps: CheckInDeps,
  user: string,
  body: AddCheckInFormBody,
): Promise<Outcome<CheckInForm>> => {
  const definition = definitionFromBody(body)
  if (!definition.ok) return definition
  const { questions, score } = definition.value
  const problem = await definitionProblems(deps, user, questions, score)
  if (problem) return fail(400, problem)
  const record = await deps.insertForm(user, {
    ...definition.value,
    notify: body.notify,
    schedule: body.schedule ?? null,
    schedule_not_before: deps.now(),
  })
  return ok(serializeCheckInForm(record))
}

const blankToNull = (text: string | null | undefined): string | null =>
  text == null || text.trim() === '' ? null : text

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** A new or changed schedule, or asking again after not asking, starts with the next slot. */
const restartsSchedule = (existing: CheckInFormRecord, body: UpdateCheckInFormBody): boolean =>
  (body.schedule !== undefined && !sameJson(body.schedule, existing.schedule)) ||
  (body.notify === true && !existing.notify) ||
  (body.archived === false && existing.archived)

const formPatch = (existing: CheckInFormRecord, body: UpdateCheckInFormBody, now: Date): CheckInFormPatch => {
  const patch: CheckInFormPatch = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.description !== undefined) patch.description = blankToNull(body.description)
  if (body.questions !== undefined) patch.questions = body.questions
  if (body.score !== undefined) patch.score = body.score
  if (body.schedule !== undefined) patch.schedule = body.schedule
  if (body.notify !== undefined) patch.notify = body.notify
  if (body.archived !== undefined) patch.archived = body.archived
  if (restartsSchedule(existing, body)) patch.schedule_not_before = now
  return patch
}

const changedDefinitionProblem = async (
  deps: CheckInDeps,
  user: string,
  existing: CheckInFormRecord,
  questions: CheckInQuestion[],
  score: CheckInScore | null,
): Promise<string | null> => {
  const problem = await definitionProblems(deps, user, questions, score)
  if (problem) return problem
  const history = (await deps.listVersions(user, existing.id)).map((version) => version.questions)
  const reused = reusedKeyProblems(history, existing.questions, questions)
  return reused.length > 0 ? reused.join('; ') : null
}

export const updateCheckInFormById = async (
  deps: CheckInDeps,
  user: string,
  id: string,
  body: UpdateCheckInFormBody,
): Promise<Outcome<CheckInForm>> => {
  if (!UUID_RE.test(id)) return fail(404, FORM_NOT_FOUND)
  const existing = await deps.getForm(user, id)
  if (!existing || existing.deleted_at) return fail(404, FORM_NOT_FOUND)
  const questions = body.questions ?? existing.questions
  const score = body.score !== undefined ? body.score : existing.score
  const changesDefinition = body.questions !== undefined || body.score !== undefined
  if (changesDefinition) {
    const problem = await changedDefinitionProblem(deps, user, existing, questions, score)
    if (problem) return fail(400, problem)
  }
  const newVersion = changesDefinition && definitionChanged(existing, { questions, score })
  const record = await deps.updateForm(user, id, formPatch(existing, body, deps.now()), { newVersion })
  return record ? ok(serializeCheckInForm(record)) : fail(404, FORM_NOT_FOUND)
}

export const deleteCheckInFormById = async (
  deps: CheckInDeps,
  user: string,
  id: string,
): Promise<CheckInForm | null> => {
  if (!UUID_RE.test(id)) return null
  const record = await deps.softDeleteForm(user, id)
  return record ? serializeCheckInForm(record) : null
}

export const restoreCheckInFormById = async (
  deps: CheckInDeps,
  user: string,
  id: string,
): Promise<CheckInForm | null> => {
  if (!UUID_RE.test(id)) return null
  const record = await deps.restoreForm(user, id, deps.now())
  return record ? serializeCheckInForm(record) : null
}

interface LogResult {
  logged: Record<string, CheckInLoggedPoint>
  log_errors: { error: string; question_key: string }[]
}

/** Writes the metric points of the answers through the metric write service, adding new custom metrics first. */
const logAnswers = async (
  deps: CheckInDeps,
  user: string,
  formName: string,
  questions: readonly CheckInQuestion[],
  score: CheckInScore | null,
  answers: Record<string, CheckInAnswerValue>,
  answeredAt: Date,
): Promise<LogResult> => {
  const points = metricPointsFor(questions, score, answers)
  if (points.length === 0) return { log_errors: [], logged: {} }
  const catalog = deps.catalog()
  let customMetrics = await deps.getCustomMetrics(user)
  const metrics: string[] = []
  for (const point of points) {
    const resolved = resolveMetricForWrite(point.metric, customMetrics, catalog)
    if (!resolved) {
      await deps.createMetric(user, {
        description: formName,
        name: point.metric,
        unit: point.unit ?? 'score',
      })
      customMetrics = await deps.getCustomMetrics(user)
    }
    metrics.push(resolved?.metric ?? point.metric)
  }
  const result = await deps.writePoints(
    user,
    points.map((point) => ({
      metric: point.metric,
      time: answeredAt,
      value: point.value,
      ...(point.unit ? { unit: point.unit } : {}),
    })),
  )
  const failed = new Map(result.errors.map((error) => [error.index, error.error]))
  const time = answeredAt.toISOString()
  const logged: Record<string, CheckInLoggedPoint> = {}
  const logErrors: LogResult['log_errors'] = []
  points.forEach((point, index) => {
    const error = failed.get(index)
    if (error) logErrors.push({ error, question_key: point.key })
    else logged[point.key] = { metric: metrics[index]!, time }
  })
  return { log_errors: logErrors, logged }
}

const withLogErrors = (checkIn: CheckIn, logErrors: LogResult['log_errors']): CheckIn =>
  logErrors.length > 0 ? { ...checkIn, log_errors: logErrors } : checkIn

const formStates = async (
  deps: CheckInDeps,
  user: string,
  form: CheckInFormRecord,
  date: string,
  timezone: string,
) => {
  const slots = form.schedule ? slotsForDay(form.schedule, date, timezone) : []
  if (slots.length === 0) return []
  const checkIns = await deps.listFormCheckInsBetween(user, form.id, slots[0]!.day_start, slots[0]!.day_end)
  return slotStates(slots, checkIns, deps.now())
}

/** Marks read the due notifications of the slots this check-in's days now have done. */
const markDoneSlotsRead = async (
  deps: CheckInDeps,
  user: string,
  formId: string,
  instants: (Date | null)[],
) => {
  const form = await deps.getForm(user, formId)
  if (!form?.schedule) return
  const timezone = await deps.getTimezone(user)
  const days = new Set(
    instants
      .filter((instant): instant is Date => instant !== null)
      .map((instant) => currentDay(instant, form.schedule!.day_starts_at, timezone)),
  )
  const done: string[] = []
  for (const day of days) {
    for (const { slot, state } of await formStates(deps, user, form, day, timezone)) {
      if (state === 'done') done.push(slot.at.toISOString())
    }
  }
  await deps.markDueRead(user, formId, done)
}

const answerError = (questions: readonly CheckInQuestion[], answers: Record<string, CheckInAnswerValue>) => {
  const problems = answerProblems(questions, answers)
  return problems.length > 0 ? problems.join('; ') : null
}

export const submitCheckIn = async (
  deps: CheckInDeps,
  user: string,
  body: SubmitCheckInBody,
): Promise<Outcome<CheckIn>> => {
  const form = await deps.getForm(user, body.form_id)
  if (!form || form.deleted_at) return fail(404, FORM_NOT_FOUND)
  const problem = answerError(form.questions, body.answers)
  if (problem) return fail(400, problem)
  const answeredAt = body.answered_at ? new Date(body.answered_at) : deps.now()
  const scheduledFor = body.scheduled_for ? new Date(body.scheduled_for) : null
  const { log_errors, logged } = await logAnswers(
    deps,
    user,
    form.name,
    form.questions,
    form.score,
    body.answers,
    answeredAt,
  )
  const record = await deps.insertCheckIn(user, {
    answered_at: answeredAt,
    answers: body.answers,
    form_id: form.id,
    form_version: form.version,
    logged,
    note: blankToNull(body.note),
    scheduled_for: scheduledFor,
  })
  await markDoneSlotsRead(deps, user, form.id, [answeredAt, scheduledFor])
  return ok(withLogErrors(serializeCheckIn(record), log_errors))
}

export const updateCheckInById = async (
  deps: CheckInDeps,
  user: string,
  id: string,
  body: UpdateCheckInBody,
): Promise<Outcome<CheckIn>> => {
  if (!UUID_RE.test(id)) return fail(404, CHECK_IN_NOT_FOUND)
  const existing = await deps.getCheckIn(user, id)
  if (!existing || existing.deleted_at) return fail(404, CHECK_IN_NOT_FOUND)
  const answers = body.answers ?? existing.answers
  const problem = answerError(existing.questions, answers)
  if (problem) return fail(400, problem)
  const answeredAt = body.answered_at ? new Date(body.answered_at) : existing.answered_at
  const patch: CheckInPatch = {}
  if (body.answers !== undefined) patch.answers = body.answers
  if (body.answered_at !== undefined) patch.answered_at = answeredAt
  if (body.note !== undefined) patch.note = blankToNull(body.note)
  if (body.scheduled_for !== undefined) {
    patch.scheduled_for = body.scheduled_for === null ? null : new Date(body.scheduled_for)
  }
  let logErrors: LogResult['log_errors'] = []
  if (body.answers !== undefined || body.answered_at !== undefined) {
    await deps.deletePoints(user, Object.values(existing.logged))
    const result = await logAnswers(
      deps,
      user,
      existing.form_name,
      existing.questions,
      existing.score_definition,
      answers,
      answeredAt,
    )
    patch.logged = result.logged
    logErrors = result.log_errors
  }
  const record = await deps.updateCheckIn(user, id, patch)
  if (!record) return fail(404, CHECK_IN_NOT_FOUND)
  await markDoneSlotsRead(deps, user, record.form_id, [record.answered_at, record.scheduled_for])
  return ok(withLogErrors(serializeCheckIn(record), logErrors))
}

export const deleteCheckInById = async (
  deps: CheckInDeps,
  user: string,
  id: string,
): Promise<CheckIn | null> => {
  if (!UUID_RE.test(id)) return null
  const existing = await deps.getCheckIn(user, id)
  if (!existing || existing.deleted_at) return null
  await deps.deletePoints(user, Object.values(existing.logged))
  if (!(await deps.setCheckInDeleted(user, id, true))) return null
  const record = await deps.getCheckIn(user, id)
  return record ? serializeCheckIn(record) : null
}

export const restoreCheckInById = async (
  deps: CheckInDeps,
  user: string,
  id: string,
): Promise<Outcome<CheckIn>> => {
  if (!UUID_RE.test(id)) return fail(404, CHECK_IN_NOT_FOUND)
  const existing = await deps.getCheckIn(user, id)
  if (!existing || !existing.deleted_at) return fail(404, CHECK_IN_NOT_FOUND)
  if (!(await deps.setCheckInDeleted(user, id, false))) return fail(404, CHECK_IN_NOT_FOUND)
  const { log_errors, logged } = await logAnswers(
    deps,
    user,
    existing.form_name,
    existing.questions,
    existing.score_definition,
    existing.answers,
    existing.answered_at,
  )
  const record = await deps.updateCheckIn(user, id, { logged })
  if (!record) return fail(404, CHECK_IN_NOT_FOUND)
  return ok(withLogErrors(serializeCheckIn(record), log_errors))
}

export const queryCheckIns = async (
  deps: CheckInDeps,
  user: string,
  query: CheckInsQuery,
): Promise<Pick<CheckInsResponse, 'check_ins' | 'next_cursor'>> => {
  const rows = await deps.listCheckIns(user, {
    ...(query.from ? { from: new Date(query.from) } : {}),
    ...(query.to ? { to: new Date(query.to) } : {}),
    ...(query.form_id ? { form_id: query.form_id } : {}),
    ...(query.deleted ? { deleted: true } : {}),
    before: decodeKeysetCursor(query.cursor),
    limit: query.limit + 1,
  })
  const page = rows.slice(0, query.limit)
  const last = page.at(-1)
  return {
    check_ins: page.map(({ cursor_ts: _cursor, ...record }) => serializeCheckIn(record)),
    next_cursor: rows.length > query.limit && last ? encodeKeysetCursor(last.cursor_ts, last.id) : null,
  }
}

const isScheduled = (form: CheckInFormRecord): boolean => form.schedule !== null && !form.archived

const toDueSlot = (
  form: CheckInFormRecord,
  slot: ScheduleSlot,
  state: DueSlot['state'],
  checkInId: string | null,
) => ({
  check_in_id: checkInId,
  date: slot.date,
  form_id: form.id,
  form_name: form.name,
  scheduled_for: slot.at.toISOString(),
  state,
  time: slot.time,
})

/** The slots of every scheduled form on `date`, or on each form's current day. */
export const listDue = async (
  deps: CheckInDeps,
  user: string,
  date?: string,
): Promise<Pick<DueResponse, 'slots' | 'timezone'>> => {
  const [forms, timezone] = await Promise.all([deps.listForms(user, {}), deps.getTimezone(user)])
  const now = deps.now()
  const slots: DueSlot[] = []
  for (const form of forms.filter(isScheduled)) {
    const day = date ?? currentDay(now, form.schedule!.day_starts_at, timezone)
    for (const { check_in_id, slot, state } of await formStates(deps, user, form, day, timezone)) {
      slots.push(toDueSlot(form, slot, state, check_in_id))
    }
  }
  slots.sort(
    (a, b) => a.scheduled_for.localeCompare(b.scheduled_for) || a.form_name.localeCompare(b.form_name),
  )
  return { slots, timezone }
}

export const checkInDueDedupeKey = (formId: string, slot: Pick<ScheduleSlot, 'date' | 'time'>): string =>
  `check_in:${formId}:${slot.date}:${slot.time}`

/**
 * Raises a `check_in_due` notification for each slot whose time passed less than an hour ago, at or
 * after the form's `schedule_not_before`, that no check-in has done. Resolves to how many it raised.
 */
export const raiseDueCheckIns = async (deps: CheckInDeps, user: string): Promise<number> => {
  const forms = (await deps.listForms(user, {})).filter((form) => isScheduled(form) && form.notify)
  if (forms.length === 0) return 0
  const timezone = await deps.getTimezone(user)
  const now = deps.now()
  let raised = 0
  for (const form of forms) {
    const today = currentDay(now, form.schedule!.day_starts_at, timezone)
    const yesterday = Temporal.PlainDate.from(today).subtract({ days: 1 }).toString()
    const isCandidate = (slot: ScheduleSlot): boolean => {
      const age = now.getTime() - slot.at.getTime()
      return age >= 0 && age < DUE_WINDOW_MS && slot.at.getTime() >= form.schedule_not_before.getTime()
    }
    for (const day of [yesterday, today]) {
      const candidates = slotsForDay(form.schedule!, day, timezone).filter(isCandidate)
      if (candidates.length === 0) continue
      for (const { slot, state } of await formStates(deps, user, form, day, timezone)) {
        if (state === 'done' || !isCandidate(slot)) continue
        raised++
        await deps.raise(user, {
          data: { form_id: form.id, scheduled_for: slot.at.toISOString() },
          dedupe_key: checkInDueDedupeKey(form.id, slot),
          link: `/check-ins/${form.id}`,
          title: form.name,
          type: 'check_in_due',
        })
      }
    }
  }
  return raised
}
