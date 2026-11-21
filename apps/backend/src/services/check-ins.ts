import type {
  AddCheckInFormBody,
  CheckIn,
  CheckInAdherence,
  CheckInAdherenceQuery,
  CheckInAnswerValue,
  CheckInForm,
  CheckInQuestion,
  CheckInScore,
  CheckInsQuery,
  CheckInsResponse,
  CheckInTemplate,
  CustomMetricDefinition,
  DataSchemaDefinition,
  DueSlot,
  DueResponse,
  StoredMetricCatalog,
  SubmitCheckInBody,
  UpdateCheckInBody,
  UpdateCheckInFormBody,
} from '@aurboda/api-spec'

import {
  CHECK_IN_ADHERENCE_DAYS_DEFAULT,
  CHECK_IN_ADHERENCE_DAYS_MAX,
  checkInFormProblems,
  DEFAULT_DAY_STARTS_AT,
  isCheckInRoutine,
  isTakenAnswer,
  presetLine,
  UUID_RE,
} from '@aurboda/api-spec'
import { randomUUID } from 'node:crypto'

import type { ActivityNotifier } from './deduction-queue.ts'
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
  deleteSkippedCheckIns,
  getActivityById,
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
  listOverridesOfActivities,
  markCheckInDueNotificationsRead,
  restoreCheckInForm,
  setCheckInDeleted,
  type SlotCheckInRecord,
  softDeleteCheckInForm,
  updateCheckIn,
  updateCheckInForm,
  withCheckInFormLock,
} from '../db/index.ts'
import {
  activityItemsFor,
  activityTargetProblems,
  answerProblems,
  defaultProblems,
  definitionChanged,
  metricPointsFor,
  presetAnswers,
  reusedKeyProblems,
  scoreOf,
} from './check-in-definitions.ts'
import { checkInTemplates, findCheckInTemplate } from './check-in-templates.ts'
import { addCustomMetric, getCustomMetrics } from './custom-metrics.ts'
import {
  currentDay,
  dayWindow,
  type ScheduleSlot,
  slotsBetween,
  slotsForDay,
  slotStates,
  type SlotWithState,
} from './due-items.ts'
import { decodeKeysetCursor, encodeKeysetCursor } from './keyset-cursor.ts'
import { loadMetricCatalog } from './metric-catalog.ts'
import { resolveMetricForWrite, valueForWrite } from './metric-resolution.ts'
import {
  activityWriteSchema,
  addActivity,
  bulkAddMetrics,
  deleteActivity,
  restoreActivity,
} from './mutations.ts'
import { type Notifier, notifier } from './notifications.ts'
import { getUserTimezone } from './settings.ts'

const DUE_WINDOW_MS = 60 * 60 * 1000

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 409; error: string }

const ok = <T>(value: T): Outcome<T> => ({ ok: true, value })
const fail = <T>(status: 400 | 404 | 409, error: string): Outcome<T> => ({ error, ok: false, status })

export interface CheckInActivityInput {
  activity_type: string
  data: Record<string, unknown>
  start_time: Date
  external_id: string
}

export interface ActivitySpan {
  activity_type: string
  start_time: Date
  end_time?: Date | null
}

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
  deleteSkips: (user: string, formId: string, scheduledFor: Date) => Promise<unknown>
  deletePoints: (user: string, points: readonly CheckInLoggedPoint[]) => Promise<unknown>
  writePoints: (user: string, items: BulkMetricItem[]) => Promise<BulkAddMetricsResult>
  getCustomMetrics: (user: string) => Promise<CustomMetricDefinition[]>
  createMetric: (user: string, definition: CustomMetricDefinition) => Promise<unknown>
  catalog: () => StoredMetricCatalog
  /** The data schema of an activity type of the user or the catalogue; undefined when it is neither. */
  activityTypeSchema: (
    user: string,
    activityType: string,
  ) => Promise<{ schema: DataSchemaDefinition | undefined } | undefined>
  addActivity: (
    user: string,
    input: CheckInActivityInput,
    onMutated?: ActivityNotifier,
  ) => Promise<{ success: true; id: string } | { success: false; error: string }>
  /** Soft-deletes it and resolves to what it deleted; null when there was no live activity to delete. */
  deleteActivity: (user: string, id: string) => Promise<ActivitySpan | null>
  /** Resolves to what it restored; null when there was no deleted activity to restore. */
  restoreActivity: (user: string, id: string) => Promise<ActivitySpan | null>
  activityIsLive: (user: string, id: string) => Promise<boolean>
  /**
   * The overrides all of whose targets are among `activityIds`: the live ones, or with
   * `deletedSince` those deleted at or after it.
   */
  overridesOf: (user: string, activityIds: readonly string[], deletedSince?: Date) => Promise<string[]>
  /** Tells deduction rules that an activity was added, deleted or restored. */
  activityMutated?: ActivityNotifier
  /** Runs `fn` as the form's only writer, across processes. Not re-entrant. */
  withFormLock: <T>(user: string, formId: string, fn: () => Promise<T>) => Promise<T>
  markDueRead: (user: string, formId: string, scheduledFor: readonly string[]) => Promise<unknown>
  raise: Notifier['raiseBestEffort']
  getTimezone: (user: string) => Promise<string>
  now: () => Date
}

/** Resolved at call time, so importing this module never touches the db module's bindings. */
export const checkInDeps: CheckInDeps = {
  activityIsLive: async (user, id) => (await getActivityById(user, id)) !== null,
  activityMutated: () => undefined,
  activityTypeSchema: (user, activityType) => activityWriteSchema(user, activityType),
  addActivity: async (user, input, onMutated) => {
    const result = await addActivity(user, { ...input, source: 'check_in' }, onMutated)
    return result.success && result.id
      ? { id: result.id, success: true }
      : { error: result.error ?? 'Could not add the activity', success: false }
  },
  catalog: () => loadMetricCatalog(),
  createMetric: (user, definition) => addCustomMetric(user, { ...definition, separate_metric: true }),
  deleteActivity: async (user, id) => {
    const activity = await getActivityById(user, id)
    return activity && (await deleteActivity(user, id)).deleted ? activity : null
  },
  deletePoints: (user, points) => deleteCheckInPoints(user, points),
  deleteSkips: (user, formId, scheduledFor) => deleteSkippedCheckIns(user, formId, scheduledFor),
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
  overridesOf: (user, activityIds, deletedSince) =>
    listOverridesOfActivities(user, activityIds, deletedSince),
  raise: (user, input) => notifier.raiseBestEffort(user, input),
  restoreActivity: async (user, id) =>
    (await restoreActivity(user, id)).restored ? await getActivityById(user, id) : null,
  restoreForm: (user, id, notBefore) => restoreCheckInForm(user, id, notBefore),
  setCheckInDeleted: (user, id, deleted) => setCheckInDeleted(user, id, deleted),
  softDeleteForm: (user, id) => softDeleteCheckInForm(user, id),
  updateCheckIn: (user, id, patch) => updateCheckIn(user, id, patch),
  updateForm: (user, id, patch, options) => updateCheckInForm(user, id, patch, options),
  withFormLock: (user, formId, fn) => withCheckInFormLock(user, formId, fn),
  writePoints: (user, items) => bulkAddMetrics(user, items, 'check_in', undefined, { outboundSync: true }),
}

const FORM_NOT_FOUND = 'Check-in form not found'
const CHECK_IN_NOT_FOUND = 'Check-in not found'

export const serializeCheckInForm = (record: CheckInFormRecord): CheckInForm => ({
  archived: record.archived,
  created_at: record.created_at.toISOString(),
  deleted_at: record.deleted_at?.toISOString() ?? null,
  description: record.description,
  id: record.id,
  is_routine: isCheckInRoutine(record.questions),
  name: record.name,
  notify: record.notify,
  questions: record.questions,
  schedule: record.schedule,
  score: record.score,
  updated_at: record.updated_at.toISOString(),
  version: record.version,
})

const checkInActivities = (record: CheckInRecord): CheckIn['activities'] => {
  const live = new Set(record.live_activity_ids)
  return Object.fromEntries(
    Object.entries(record.activity_ids).map(([key, id]) => [key, { activity_id: id, logged: live.has(id) }]),
  )
}

export const serializeCheckIn = (record: CheckInRecord): CheckIn => ({
  activities: checkInActivities(record),
  answered_at: record.answered_at.toISOString(),
  answers: record.answers,
  created_at: record.created_at.toISOString(),
  deleted_at: record.deleted_at?.toISOString() ?? null,
  entity_id: record.entity_id,
  entity_type: record.entity_type,
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
    question.logs_to?.metric !== undefined
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
  const shape = [
    ...checkInFormProblems(questions, score).map((problem) => problem.message),
    ...defaultProblems(questions),
  ]
  if (shape.length > 0) return shape.join('; ')
  const targets = [
    ...metricTargetProblems(questions, score, await deps.getCustomMetrics(user), deps.catalog()),
    ...(await activityTargetsProblems(deps, user, questions)),
  ]
  return targets.length > 0 ? targets.join('; ') : null
}

const activityTargetsProblems = async (
  deps: CheckInDeps,
  user: string,
  questions: readonly CheckInQuestion[],
): Promise<string[]> => {
  const problems: string[] = []
  for (const question of questions) {
    const logsTo = question.logs_to
    if (logsTo?.activity_type === undefined) continue
    const target = await deps.activityTypeSchema(user, logsTo.activity_type)
    if (!target) {
      problems.push(
        `"${question.key}" logs to "${logsTo.activity_type}", which is neither one of your activity types nor in the catalogue`,
      )
      continue
    }
    problems.push(...activityTargetProblems(question, logsTo, target.schema))
  }
  return problems
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
): Promise<Outcome<CheckInForm>> =>
  UUID_RE.test(id)
    ? deps.withFormLock(user, id, () => updateCheckInFormLocked(deps, user, id, body))
    : fail(404, FORM_NOT_FOUND)

const updateCheckInFormLocked = async (
  deps: CheckInDeps,
  user: string,
  id: string,
  body: UpdateCheckInFormBody,
): Promise<Outcome<CheckInForm>> => {
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
  const record = await deps.withFormLock(user, id, () => deps.softDeleteForm(user, id))
  return record ? serializeCheckInForm(record) : null
}

export const restoreCheckInFormById = async (
  deps: CheckInDeps,
  user: string,
  id: string,
): Promise<CheckInForm | null> => {
  if (!UUID_RE.test(id)) return null
  const record = await deps.withFormLock(user, id, () => deps.restoreForm(user, id, deps.now()))
  return record ? serializeCheckInForm(record) : null
}

type LogErrors = { error: string; question_key: string }[]

interface LogResult {
  logged: Record<string, CheckInLoggedPoint>
  log_errors: LogErrors
}

/** What a check-in has in place while it is being logged or unlogged, step by step. */
interface Written {
  logged: Record<string, CheckInLoggedPoint>
  activity_ids: Record<string, string>
}

/**
 * Runs `steps`. When one throws, it stores on the check-in what `written` says is in place by then,
 * so `logged` and `activity_ids` never claim what is gone, and rethrows.
 */
const storingWrittenOnFailure = async <T>(
  deps: CheckInDeps,
  user: string,
  id: string,
  written: Written,
  steps: () => Promise<T>,
): Promise<T> => {
  try {
    return await steps()
  } catch (error) {
    await deps
      .updateCheckIn(user, id, { activity_ids: { ...written.activity_ids }, logged: { ...written.logged } })
      .catch(() => null)
    throw error
  }
}

const notifyActivity = (deps: CheckInDeps, user: string, activity: ActivitySpan): void =>
  deps.activityMutated?.(
    user,
    activity.activity_type,
    activity.start_time,
    activity.end_time ?? activity.start_time,
  )

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
  const logErrors: LogErrors = []
  points.forEach((point, index) => {
    const error = failed.get(index)
    if (error) logErrors.push({ error, question_key: point.key })
    else logged[point.key] = { metric: metrics[index]!, time }
  })
  return { log_errors: logErrors, logged }
}

/**
 * Adds the activities of the answers. Each gets its own `external_id`, so items of one type at the
 * same time stay apart, and a re-log after an edit never meets the soft-deleted activity it replaces.
 */
const logActivities = async (
  deps: CheckInDeps,
  user: string,
  questions: readonly CheckInQuestion[],
  answers: Record<string, CheckInAnswerValue>,
  answeredAt: Date,
  written: Written,
): Promise<{ activity_ids: Record<string, string>; log_errors: LogErrors }> => {
  const activityIds: Record<string, string> = {}
  const logErrors: LogErrors = []
  for (const item of activityItemsFor(questions, answers)) {
    const result = await deps.addActivity(
      user,
      {
        activity_type: item.activity_type,
        data: item.data,
        external_id: `check_in:${randomUUID()}`,
        start_time: answeredAt,
      },
      deps.activityMutated,
    )
    if (result.success) {
      activityIds[item.key] = result.id
      written.activity_ids[item.key] = result.id
    } else logErrors.push({ error: result.error, question_key: item.key })
  }
  return { activity_ids: activityIds, log_errors: logErrors }
}

const logEverything = async (
  deps: CheckInDeps,
  user: string,
  source: { formName: string; questions: readonly CheckInQuestion[]; score: CheckInScore | null },
  answers: Record<string, CheckInAnswerValue>,
  answeredAt: Date,
  written: Written = { activity_ids: {}, logged: {} },
): Promise<LogResult & { activity_ids: Record<string, string> }> => {
  const metrics = await logAnswers(
    deps,
    user,
    source.formName,
    source.questions,
    source.score,
    answers,
    answeredAt,
  )
  written.logged = metrics.logged
  const activities = await logActivities(deps, user, source.questions, answers, answeredAt, written)
  return {
    activity_ids: activities.activity_ids,
    log_errors: [...metrics.log_errors, ...activities.log_errors],
    logged: metrics.logged,
  }
}

/**
 * Deletes the activities, and the overrides (Timeline edits) all of whose targets are among them.
 * Resolves to those of the activities that were live and are now deleted; `onEach` hears of each
 * activity as it is done with, whether it was deleted.
 */
const deleteActivities = async (
  deps: CheckInDeps,
  user: string,
  activityIds: Record<string, string>,
  onEach: (key: string, deleted: boolean) => void,
): Promise<Record<string, string>> => {
  const deleted: Record<string, string> = {}
  for (const [key, id] of Object.entries(activityIds)) {
    const activity = await deps.deleteActivity(user, id)
    if (activity) {
      deleted[key] = id
      notifyActivity(deps, user, activity)
    }
    onEach(key, activity !== null)
  }
  for (const overrideId of await deps.overridesOf(user, Object.values(activityIds))) {
    const override = await deps.deleteActivity(user, overrideId)
    if (override) notifyActivity(deps, user, override)
  }
  return deleted
}

/** Restores the activities, and their overrides that were deleted at or after `deletedAt`. */
const restoreActivities = async (
  deps: CheckInDeps,
  user: string,
  activityIds: readonly string[],
  deletedAt: Date,
): Promise<void> => {
  const restored: string[] = []
  for (const id of activityIds) {
    const activity = await deps.restoreActivity(user, id)
    if (!activity) continue
    restored.push(id)
    notifyActivity(deps, user, activity)
  }
  for (const overrideId of await deps.overridesOf(user, restored, deletedAt)) {
    const override = await deps.restoreActivity(user, overrideId)
    if (override) notifyActivity(deps, user, override)
  }
}

const withLogErrors = (checkIn: CheckIn, logErrors: LogErrors): CheckIn =>
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

const isClosed = (state: DueSlot['state']): boolean => state === 'done' || state === 'skipped'

/** The slot of the form at `scheduledFor` with its state, or null when the schedule has no such slot. */
export const formSlotAt = async (
  deps: CheckInDeps,
  user: string,
  form: CheckInFormRecord,
  scheduledFor: Date,
): Promise<SlotWithState | null> => {
  if (!form.schedule) return null
  const timezone = await deps.getTimezone(user)
  const day = currentDay(scheduledFor, form.schedule.day_starts_at, timezone)
  const states = await formStates(deps, user, form, day, timezone)
  return states.find(({ slot }) => slot.at.getTime() === scheduledFor.getTime()) ?? null
}

/** Marks read the due notifications of the slots this check-in's days now have done or skipped. */
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
  const closed: string[] = []
  for (const day of days) {
    for (const { slot, state } of await formStates(deps, user, form, day, timezone)) {
      if (isClosed(state)) closed.push(slot.at.toISOString())
    }
  }
  await deps.markDueRead(user, formId, closed)
}

const answerError = (questions: readonly CheckInQuestion[], answers: Record<string, CheckInAnswerValue>) => {
  const problems = answerProblems(questions, answers)
  return problems.length > 0 ? problems.join('; ') : null
}

const entityProblem = async (deps: CheckInDeps, user: string, body: SubmitCheckInBody) => {
  if (body.entity_type === undefined || body.entity_id === undefined) return null
  return (await deps.activityIsLive(user, body.entity_id))
    ? null
    : `No activity ${body.entity_id} to tie the check-in to`
}

const NOT_A_SLOT = 'scheduled_for is not a slot of this form'

const skipSlot = async (
  deps: CheckInDeps,
  user: string,
  form: CheckInFormRecord,
  body: SubmitCheckInBody,
): Promise<Outcome<CheckIn>> => {
  const scheduledFor = new Date(body.scheduled_for!)
  const slot = await formSlotAt(deps, user, form, scheduledFor)
  if (!slot) return fail(400, NOT_A_SLOT)
  if (isClosed(slot.state)) return fail(409, `This slot is already ${slot.state}`)
  const record = await deps.insertCheckIn(user, {
    activity_ids: {},
    answered_at: body.answered_at ? new Date(body.answered_at) : deps.now(),
    answers: {},
    entity_id: body.entity_id ?? null,
    entity_type: body.entity_type ?? null,
    form_id: form.id,
    form_version: form.version,
    logged: {},
    note: blankToNull(body.note),
    scheduled_for: scheduledFor,
    status: 'skipped',
  })
  await markDoneSlotsRead(deps, user, form.id, [scheduledFor])
  return ok(serializeCheckIn(record))
}

export const submitCheckIn = (
  deps: CheckInDeps,
  user: string,
  body: SubmitCheckInBody,
): Promise<Outcome<CheckIn>> =>
  deps.withFormLock(user, body.form_id, () => submitCheckInLocked(deps, user, body))

/** `submitCheckIn` for a caller that already holds the form's lock. */
export const submitCheckInLocked = async (
  deps: CheckInDeps,
  user: string,
  body: SubmitCheckInBody,
): Promise<Outcome<CheckIn>> => {
  const form = await deps.getForm(user, body.form_id)
  if (!form || form.deleted_at) return fail(404, FORM_NOT_FOUND)
  const entity = await entityProblem(deps, user, body)
  if (entity) return fail(400, entity)
  if (body.status === 'skipped') return skipSlot(deps, user, form, body)
  if (body.use_defaults && !isCheckInRoutine(form.questions)) {
    return fail(400, 'This form is not a routine: a required question has no default')
  }
  const answers = body.use_defaults ? { ...presetAnswers(form.questions), ...body.answers } : body.answers
  const problem = answerError(form.questions, answers)
  if (problem) return fail(400, problem)
  const answeredAt = body.answered_at ? new Date(body.answered_at) : deps.now()
  const scheduledFor = body.scheduled_for ? new Date(body.scheduled_for) : null
  const { activity_ids, log_errors, logged } = await logEverything(
    deps,
    user,
    { formName: form.name, questions: form.questions, score: form.score },
    answers,
    answeredAt,
  )
  if (scheduledFor) await deps.deleteSkips(user, form.id, scheduledFor)
  const record = await deps.insertCheckIn(user, {
    activity_ids,
    answered_at: answeredAt,
    answers,
    entity_id: body.entity_id ?? null,
    entity_type: body.entity_type ?? null,
    form_id: form.id,
    form_version: form.version,
    logged,
    note: blankToNull(body.note),
    scheduled_for: scheduledFor,
    status: 'answered',
  })
  await markDoneSlotsRead(deps, user, form.id, [answeredAt, scheduledFor])
  return ok(withLogErrors(serializeCheckIn(record), log_errors))
}

/**
 * Runs `fn` on the check-in holding its form's lock, the check-in read again inside it; null when
 * there is no such check-in.
 */
const withCheckInLocked = async <T>(
  deps: CheckInDeps,
  user: string,
  id: string,
  fn: (checkIn: CheckInRecord) => Promise<T>,
): Promise<T | null> => {
  if (!UUID_RE.test(id)) return null
  const before = await deps.getCheckIn(user, id)
  if (!before) return null
  return deps.withFormLock(user, before.form_id, async () => {
    const checkIn = await deps.getCheckIn(user, id)
    return checkIn ? fn(checkIn) : null
  })
}

const checkInPatch = (body: UpdateCheckInBody, answeredAt: Date): CheckInPatch => {
  const patch: CheckInPatch = {}
  if (body.answers !== undefined) patch.answers = body.answers
  if (body.answered_at !== undefined) patch.answered_at = answeredAt
  if (body.note !== undefined) patch.note = blankToNull(body.note)
  if (body.scheduled_for !== undefined) {
    patch.scheduled_for = body.scheduled_for === null ? null : new Date(body.scheduled_for)
  }
  return patch
}

/** A skip moved to another instant must take an open slot of its form; it cannot leave its slot. */
const movedSkipProblem = async (
  deps: CheckInDeps,
  user: string,
  existing: CheckInRecord,
  scheduledFor: string | null,
): Promise<Outcome<CheckIn> | null> => {
  if (scheduledFor === null) {
    return fail(400, 'A skipped check-in needs its slot: scheduled_for cannot be null')
  }
  const at = new Date(scheduledFor)
  if (existing.scheduled_for?.getTime() === at.getTime()) return null
  const form = await deps.getForm(user, existing.form_id)
  const slot = form ? await formSlotAt(deps, user, form, at) : null
  if (!slot) return fail(400, NOT_A_SLOT)
  if (isClosed(slot.state) && slot.check_in_id !== existing.id) {
    return fail(409, `This slot is already ${slot.state}`)
  }
  return null
}

export const updateCheckInById = async (
  deps: CheckInDeps,
  user: string,
  id: string,
  body: UpdateCheckInBody,
): Promise<Outcome<CheckIn>> =>
  (await withCheckInLocked(deps, user, id, (existing) => updateCheckInLocked(deps, user, existing, body))) ??
  fail(404, CHECK_IN_NOT_FOUND)

const updateCheckInLocked = async (
  deps: CheckInDeps,
  user: string,
  existing: CheckInRecord,
  body: UpdateCheckInBody,
): Promise<Outcome<CheckIn>> => {
  if (existing.deleted_at) return fail(404, CHECK_IN_NOT_FOUND)
  if (existing.status === 'skipped' && body.answers !== undefined) {
    return fail(400, 'A skipped check-in has no answers; answer the slot with a new check-in instead')
  }
  if (existing.status === 'skipped' && body.scheduled_for !== undefined) {
    const moved = await movedSkipProblem(deps, user, existing, body.scheduled_for)
    if (moved) return moved
  }
  const answers = body.answers ?? existing.answers
  const problem = existing.status === 'answered' ? answerError(existing.questions, answers) : null
  if (problem) return fail(400, problem)
  const answeredAt = body.answered_at ? new Date(body.answered_at) : existing.answered_at
  const patch = checkInPatch(body, answeredAt)
  const relogs = body.answers !== undefined || body.answered_at !== undefined
  const written: Written = { activity_ids: { ...existing.activity_ids }, logged: { ...existing.logged } }
  const outcome = await storingWrittenOnFailure(deps, user, existing.id, written, async () => {
    let logErrors: LogErrors = []
    if (relogs) {
      await deps.deletePoints(user, Object.values(existing.logged))
      written.logged = {}
      await deleteActivities(deps, user, existing.activity_ids, (key) => {
        delete written.activity_ids[key]
      })
      const result = await logEverything(
        deps,
        user,
        { formName: existing.form_name, questions: existing.questions, score: existing.score_definition },
        answers,
        answeredAt,
        written,
      )
      patch.logged = result.logged
      patch.activity_ids = result.activity_ids
      logErrors = result.log_errors
    }
    return { logErrors, record: await deps.updateCheckIn(user, existing.id, patch) }
  })
  if (!outcome.record) return fail(404, CHECK_IN_NOT_FOUND)
  const { record } = outcome
  await markDoneSlotsRead(deps, user, record.form_id, [record.answered_at, record.scheduled_for])
  return ok(withLogErrors(serializeCheckIn(record), outcome.logErrors))
}

/**
 * Soft-deletes the check-in, removes its points and soft-deletes its activities with their
 * overrides. It keeps the ids of only the activities this deleted, so a restore brings back no
 * activity deleted on its own. The check-in is marked deleted before its activities, so their
 * overrides are deleted at or after it, which is how a restore finds them.
 */
export const deleteCheckInById = async (
  deps: CheckInDeps,
  user: string,
  id: string,
): Promise<CheckIn | null> =>
  withCheckInLocked(deps, user, id, async (existing) => {
    if (existing.deleted_at) return null
    const written: Written = { activity_ids: { ...existing.activity_ids }, logged: { ...existing.logged } }
    return storingWrittenOnFailure(deps, user, id, written, async () => {
      await deps.deletePoints(user, Object.values(existing.logged))
      written.logged = {}
      if (!(await deps.setCheckInDeleted(user, id, true))) {
        await deps.updateCheckIn(user, id, { logged: {} })
        return null
      }
      const deleted = await deleteActivities(deps, user, existing.activity_ids, (key, wasDeleted) => {
        if (!wasDeleted) delete written.activity_ids[key]
      })
      const record = await deps.updateCheckIn(user, id, { activity_ids: deleted })
      return record ? serializeCheckIn(record) : null
    })
  })

/**
 * A restored skip must find its slot still open; a restored answer to a slot replaces the skips
 * of it, as a new answer does.
 */
const restoreSlotProblem = async (
  deps: CheckInDeps,
  user: string,
  existing: CheckInRecord,
): Promise<Outcome<CheckIn> | null> => {
  if (!existing.scheduled_for) return null
  if (existing.status === 'answered') {
    await deps.deleteSkips(user, existing.form_id, existing.scheduled_for)
    return null
  }
  const form = await deps.getForm(user, existing.form_id)
  const slot = form ? await formSlotAt(deps, user, form, existing.scheduled_for) : null
  return slot && isClosed(slot.state) ? fail(409, `This slot is already ${slot.state}`) : null
}

export const restoreCheckInById = async (
  deps: CheckInDeps,
  user: string,
  id: string,
): Promise<Outcome<CheckIn>> =>
  (await withCheckInLocked(deps, user, id, (existing) => restoreCheckInLocked(deps, user, existing))) ??
  fail(404, CHECK_IN_NOT_FOUND)

const restoreCheckInLocked = async (
  deps: CheckInDeps,
  user: string,
  existing: CheckInRecord,
): Promise<Outcome<CheckIn>> => {
  const deletedAt = existing.deleted_at
  if (!deletedAt) return fail(404, CHECK_IN_NOT_FOUND)
  const slotProblem = await restoreSlotProblem(deps, user, existing)
  if (slotProblem) return slotProblem
  if (!(await deps.setCheckInDeleted(user, existing.id, false))) return fail(404, CHECK_IN_NOT_FOUND)
  const written: Written = { activity_ids: { ...existing.activity_ids }, logged: {} }
  return storingWrittenOnFailure(deps, user, existing.id, written, async () => {
    const { log_errors, logged } = await logAnswers(
      deps,
      user,
      existing.form_name,
      existing.questions,
      existing.score_definition,
      existing.answers,
      existing.answered_at,
    )
    written.logged = logged
    await restoreActivities(deps, user, Object.values(existing.activity_ids), deletedAt)
    const record = await deps.updateCheckIn(user, existing.id, { logged })
    if (!record) return fail(404, CHECK_IN_NOT_FOUND)
    return ok(withLogErrors(serializeCheckIn(record), log_errors))
  })
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
    ...(query.entity_type && query.entity_id
      ? { entity: { id: query.entity_id, type: query.entity_type } }
      : {}),
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

export const CHECK_IN_DUE_ACTIONS = [
  { key: 'done', label: 'Done' },
  { key: 'skip', label: 'Skip' },
]

/** A routine's due notification lists its preset items and offers Done and Skip. */
const routineExtras = (form: CheckInFormRecord) => {
  if (!isCheckInRoutine(form.questions)) return {}
  const line = presetLine(form.questions)
  return { actions: CHECK_IN_DUE_ACTIONS, ...(line ? { body: line } : {}) }
}

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
        if (isClosed(state) || !isCandidate(slot)) continue
        raised++
        await deps.raise(user, {
          ...routineExtras(form),
          data: { form_id: form.id, scheduled_for: slot.at.toISOString() },
          dedupe_key: checkInDueDedupeKey(form.id, slot),
          link: `/check-ins/${form.id}?slot=${encodeURIComponent(slot.at.toISOString())}`,
          title: form.name,
          type: 'check_in_due',
        })
      }
    }
  }
  return raised
}

const addDays = (date: string, days: number): string => Temporal.PlainDate.from(date).add({ days }).toString()

const daysFrom = (from: string, to: string): number =>
  Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to)).days + 1

type AdherenceCounts = CheckInAdherence['totals']

const emptyCounts = (): AdherenceCounts => ({ done: 0, missed: 0, skipped: 0, upcoming: 0 })

const countState = (counts: AdherenceCounts, state: DueSlot['state']): void => {
  if (state === 'due' || state === 'upcoming') counts.upcoming++
  else counts[state]++
}

const takesSlotOfDay = (
  checkIn: { answered_at: Date; scheduled_for: Date | null },
  start: Date,
  end: Date,
): boolean =>
  (checkIn.answered_at >= start && checkIn.answered_at < end) ||
  (checkIn.scheduled_for !== null && checkIn.scheduled_for >= start && checkIn.scheduled_for < end)

/**
 * How a form was kept up from `from` to `to` (local days by the schedule's `day_starts_at`): its
 * slots by state under its current schedule, per day and in total, and per question how many of the
 * answered check-ins in the window answered it with something other than 0 or no. Slots before the
 * form was created count only when a check-in took them.
 */
export const getCheckInAdherence = async (
  deps: CheckInDeps,
  user: string,
  id: string,
  query: CheckInAdherenceQuery,
): Promise<Outcome<CheckInAdherence>> => {
  if (!UUID_RE.test(id)) return fail(404, FORM_NOT_FOUND)
  const form = await deps.getForm(user, id)
  if (!form || form.deleted_at) return fail(404, FORM_NOT_FOUND)
  const timezone = await deps.getTimezone(user)
  const startsAt = form.schedule?.day_starts_at ?? DEFAULT_DAY_STARTS_AT
  const to = query.to ?? currentDay(deps.now(), startsAt, timezone)
  const from = query.from ?? addDays(to, 1 - CHECK_IN_ADHERENCE_DAYS_DEFAULT)
  if (from > to) return fail(400, 'from must not be after to')
  if (daysFrom(from, to) > CHECK_IN_ADHERENCE_DAYS_MAX) {
    return fail(400, `The window is at most ${CHECK_IN_ADHERENCE_DAYS_MAX} days`)
  }
  const windowStart = dayWindow(from, startsAt, timezone).start
  const windowEnd = dayWindow(to, startsAt, timezone).end
  const checkIns = await deps.listFormCheckInsBetween(user, form.id, windowStart, windowEnd)
  const now = deps.now()
  const totals = emptyCounts()
  const days = slotsBetween(form.schedule ?? { times: [], weekdays: [] }, from, to, timezone).map(
    ({ date, slots }) => {
      const counts = emptyCounts()
      if (slots.length > 0) {
        const { day_end: end, day_start: start } = slots[0]!
        const dayCheckIns = checkIns.filter((checkIn) => takesSlotOfDay(checkIn, start, end))
        for (const { slot, state } of slotStates(slots, dayCheckIns, now)) {
          if (slot.at < form.created_at && !isClosed(state)) continue
          countState(counts, state)
          countState(totals, state)
        }
      }
      return { date, ...counts }
    },
  )
  const answered = checkIns.filter(
    (checkIn) =>
      checkIn.status === 'answered' && checkIn.answered_at >= windowStart && checkIn.answered_at < windowEnd,
  )
  return ok({
    answered_check_ins: answered.length,
    days,
    form_id: form.id,
    from,
    questions: form.questions.map((question) => ({
      answered: answered.filter((checkIn) => isTakenAnswer(question, checkIn.answers[question.key])).length,
      key: question.key,
      prompt: question.prompt,
    })),
    timezone,
    to,
    totals,
  })
}
