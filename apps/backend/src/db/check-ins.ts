import type {
  CheckInAnswerValue,
  CheckInQuestion,
  CheckInScore,
  CheckInStatus,
  Schedule,
} from '@aurboda/api-spec'

import type { KeysetCursor } from '../services/keyset-cursor.ts'

import { query, withUserTransaction } from './connection.ts'
import { buildDynamicUpdate, type UpdateEntry } from './dynamic-update.ts'

export interface CheckInFormRecord {
  id: string
  name: string
  description: string | null
  version: number
  questions: CheckInQuestion[]
  score: CheckInScore | null
  schedule: Schedule | null
  schedule_not_before: Date
  notify: boolean
  archived: boolean
  deleted_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface CheckInFormInsert {
  name: string
  description: string | null
  questions: CheckInQuestion[]
  score: CheckInScore | null
  schedule: Schedule | null
  schedule_not_before: Date
  notify: boolean
}

export interface CheckInFormPatch {
  name?: string
  description?: string | null
  questions?: CheckInQuestion[]
  score?: CheckInScore | null
  schedule?: Schedule | null
  schedule_not_before?: Date
  notify?: boolean
  archived?: boolean
}

export interface CheckInFormVersionRecord {
  version: number
  questions: CheckInQuestion[]
  score: CheckInScore | null
  created_at: Date
}

export interface CheckInLoggedPoint {
  metric: string
  time: string
}

export interface CheckInRecord {
  id: string
  form_id: string
  form_version: number
  form_name: string
  status: CheckInStatus
  answered_at: Date
  scheduled_for: Date | null
  answers: Record<string, CheckInAnswerValue>
  logged: Record<string, CheckInLoggedPoint>
  /** Question key to the activity the answer logged. */
  activity_ids: Record<string, string>
  /** The ids of `activity_ids` whose activity is not deleted. */
  live_activity_ids: string[]
  entity_type: 'activity' | null
  entity_id: string | null
  note: string | null
  questions: CheckInQuestion[]
  score_definition: CheckInScore | null
  deleted_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface CheckInInsert {
  form_id: string
  form_version: number
  status: CheckInStatus
  answered_at: Date
  scheduled_for: Date | null
  answers: Record<string, CheckInAnswerValue>
  logged: Record<string, CheckInLoggedPoint>
  activity_ids: Record<string, string>
  entity_type: 'activity' | null
  entity_id: string | null
  note: string | null
}

export interface CheckInPatch {
  answered_at?: Date
  scheduled_for?: Date | null
  answers?: Record<string, CheckInAnswerValue>
  logged?: Record<string, CheckInLoggedPoint>
  activity_ids?: Record<string, string>
  note?: string | null
}

export interface ListCheckInsOptions {
  from?: Date
  to?: Date
  form_id?: string
  entity?: { type: 'activity'; id: string }
  limit: number
  before?: KeysetCursor
  deleted?: boolean
}

export interface SlotCheckInRecord {
  id: string
  status: CheckInStatus
  answered_at: Date
  scheduled_for: Date | null
  answers: Record<string, CheckInAnswerValue>
}

const FORM_COLUMNS =
  'id, name, description, version, questions, score, schedule, schedule_not_before, notify, archived, deleted_at, created_at, updated_at'

const json = (value: unknown): string | null =>
  value === null || value === undefined ? null : JSON.stringify(value)

export const listCheckInForms = async (
  user: string,
  options: { deleted?: boolean } = {},
): Promise<CheckInFormRecord[]> => {
  const result = await query<CheckInFormRecord>(
    user,
    `SELECT ${FORM_COLUMNS} FROM check_in_forms
     WHERE ${options.deleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'}
     ORDER BY lower(name), created_at, id`,
  )
  return result.rows
}

/** Deleted forms included. */
export const getCheckInForm = async (user: string, id: string): Promise<CheckInFormRecord | null> => {
  const result = await query<CheckInFormRecord>(
    user,
    `SELECT ${FORM_COLUMNS} FROM check_in_forms WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

export const insertCheckInForm = async (user: string, input: CheckInFormInsert): Promise<CheckInFormRecord> =>
  withUserTransaction(user, async (tx) => {
    const result = await query<CheckInFormRecord>(
      tx,
      `INSERT INTO check_in_forms (name, description, questions, score, schedule, schedule_not_before, notify)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7)
       RETURNING ${FORM_COLUMNS}`,
      [
        input.name,
        input.description,
        json(input.questions),
        json(input.score),
        json(input.schedule),
        input.schedule_not_before,
        input.notify,
      ],
    )
    const form = result.rows[0]!
    await query(
      tx,
      `INSERT INTO check_in_form_versions (form_id, version, questions, score) VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
      [form.id, form.version, json(form.questions), json(form.score)],
    )
    return form
  })

/**
 * With `newVersion` the form moves to the next version, recorded with its questions and score;
 * without it, a change to them (only their order can change then) is copied to the current version.
 * Null when there is no such form.
 */
export const updateCheckInForm = async (
  user: string,
  id: string,
  patch: CheckInFormPatch,
  options: { newVersion: boolean },
): Promise<CheckInFormRecord | null> =>
  withUserTransaction(user, async (tx) => {
    const fields: UpdateEntry[] = []
    if (patch.name !== undefined) fields.push({ column: 'name', value: patch.name })
    if (patch.description !== undefined) fields.push({ column: 'description', value: patch.description })
    if (patch.questions !== undefined) {
      fields.push({ expression: 'questions = $NEXT::jsonb', values: [json(patch.questions)] })
    }
    if (patch.score !== undefined) {
      fields.push({ expression: 'score = $NEXT::jsonb', values: [json(patch.score)] })
    }
    if (patch.schedule !== undefined) {
      fields.push({ expression: 'schedule = $NEXT::jsonb', values: [json(patch.schedule)] })
    }
    if (patch.schedule_not_before !== undefined) {
      fields.push({ column: 'schedule_not_before', value: patch.schedule_not_before })
    }
    if (patch.notify !== undefined) fields.push({ column: 'notify', value: patch.notify })
    if (patch.archived !== undefined) fields.push({ column: 'archived', value: patch.archived })
    const update = buildDynamicUpdate('check_in_forms', id, fields, {
      defaultClauses: ['updated_at = NOW()', ...(options.newVersion ? ['version = version + 1'] : [])],
      returning: FORM_COLUMNS,
    })
    if (!update) return null
    const result = await query<CheckInFormRecord>(tx, update.sql, update.params)
    const form = result.rows[0]
    if (!form) return null
    if (options.newVersion) {
      await query(
        tx,
        `INSERT INTO check_in_form_versions (form_id, version, questions, score) VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
        [form.id, form.version, json(form.questions), json(form.score)],
      )
    } else if (patch.questions !== undefined || patch.score !== undefined) {
      await query(
        tx,
        `UPDATE check_in_form_versions SET questions = $3::jsonb, score = $4::jsonb WHERE form_id = $1 AND version = $2`,
        [form.id, form.version, json(form.questions), json(form.score)],
      )
    }
    return form
  })

/** Null when there is no such form in the other state. */
export const softDeleteCheckInForm = async (user: string, id: string): Promise<CheckInFormRecord | null> => {
  const result = await query<CheckInFormRecord>(
    user,
    `UPDATE check_in_forms SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL RETURNING ${FORM_COLUMNS}`,
    [id],
  )
  return result.rows[0] ?? null
}

/** Null when there is no such deleted form. */
export const restoreCheckInForm = async (
  user: string,
  id: string,
  scheduleNotBefore: Date,
): Promise<CheckInFormRecord | null> => {
  const result = await query<CheckInFormRecord>(
    user,
    `UPDATE check_in_forms SET deleted_at = NULL, schedule_not_before = $2, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NOT NULL RETURNING ${FORM_COLUMNS}`,
    [id, scheduleNotBefore],
  )
  return result.rows[0] ?? null
}

export const listCheckInFormVersions = async (
  user: string,
  formId: string,
): Promise<CheckInFormVersionRecord[]> => {
  const result = await query<CheckInFormVersionRecord>(
    user,
    `SELECT version, questions, score, created_at FROM check_in_form_versions WHERE form_id = $1 ORDER BY version`,
    [formId],
  )
  return result.rows
}

const CHECK_IN_SELECT = `
  SELECT c.id, c.form_id, c.form_version, f.name AS form_name, c.status, c.answered_at, c.scheduled_for,
         c.answers, c.logged, c.activity_ids, c.entity_type, c.entity_id, c.note, v.questions,
         v.score AS score_definition, c.deleted_at, c.created_at, c.updated_at,
         c.answered_at::text AS cursor_ts,
         ARRAY(
           SELECT a.id::text FROM activities a
            WHERE a.deleted_at IS NULL
              AND a.id = ANY(ARRAY(SELECT value::uuid FROM jsonb_each_text(c.activity_ids)))
         ) AS live_activity_ids
    FROM check_ins c
    JOIN check_in_forms f ON f.id = c.form_id
    JOIN check_in_form_versions v ON v.form_id = c.form_id AND v.version = c.form_version`

type CheckInRow = CheckInRecord & { cursor_ts: string }

const withoutCursor = ({ cursor_ts: _cursor, ...record }: CheckInRow): CheckInRecord => record

/** Deleted check-ins included. */
export const getCheckIn = async (user: string, id: string): Promise<CheckInRecord | null> => {
  const result = await query<CheckInRow>(user, `${CHECK_IN_SELECT} WHERE c.id = $1`, [id])
  const row = result.rows[0]
  return row ? withoutCursor(row) : null
}

export const insertCheckIn = async (user: string, input: CheckInInsert): Promise<CheckInRecord> => {
  const result = await query<{ id: string }>(
    user,
    `INSERT INTO check_ins (form_id, form_version, status, answered_at, scheduled_for, answers, logged,
                            activity_ids, entity_type, entity_id, note)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11)
     RETURNING id`,
    [
      input.form_id,
      input.form_version,
      input.status,
      input.answered_at,
      input.scheduled_for,
      json(input.answers),
      json(input.logged),
      json(input.activity_ids),
      input.entity_type,
      input.entity_id,
      input.note,
    ],
  )
  return (await getCheckIn(user, result.rows[0]!.id))!
}

/** Newest first; `cursor_ts` of the last row continues the list. */
export const listCheckIns = async (
  user: string,
  options: ListCheckInsOptions,
): Promise<(CheckInRecord & { cursor_ts: string })[]> => {
  const conditions = [options.deleted ? 'c.deleted_at IS NOT NULL' : 'c.deleted_at IS NULL']
  const params: unknown[] = []
  const param = (value: unknown): string => {
    params.push(value)
    return `$${params.length}`
  }
  if (options.from) conditions.push(`c.answered_at >= ${param(options.from)}`)
  if (options.to) conditions.push(`c.answered_at < ${param(options.to)}`)
  if (options.form_id) conditions.push(`c.form_id = ${param(options.form_id)}`)
  if (options.entity) {
    conditions.push(
      `c.entity_type = ${param(options.entity.type)} AND c.entity_id = ${param(options.entity.id)}`,
    )
  }
  if (options.before) {
    conditions.push(
      `(c.answered_at, c.id) < (${param(options.before.ts)}::timestamptz, ${param(options.before.id)}::uuid)`,
    )
  }
  const result = await query<CheckInRow>(
    user,
    `${CHECK_IN_SELECT} WHERE ${conditions.join(' AND ')}
     ORDER BY c.answered_at DESC, c.id DESC LIMIT ${param(options.limit)}`,
    params,
  )
  return result.rows
}

/** Null when there is no such check-in. */
export const updateCheckIn = async (
  user: string,
  id: string,
  patch: CheckInPatch,
): Promise<CheckInRecord | null> => {
  const fields: UpdateEntry[] = []
  if (patch.answered_at !== undefined) fields.push({ column: 'answered_at', value: patch.answered_at })
  if (patch.scheduled_for !== undefined) fields.push({ column: 'scheduled_for', value: patch.scheduled_for })
  if (patch.answers !== undefined) {
    fields.push({ expression: 'answers = $NEXT::jsonb', values: [json(patch.answers)] })
  }
  if (patch.logged !== undefined) {
    fields.push({ expression: 'logged = $NEXT::jsonb', values: [json(patch.logged)] })
  }
  if (patch.activity_ids !== undefined) {
    fields.push({ expression: 'activity_ids = $NEXT::jsonb', values: [json(patch.activity_ids)] })
  }
  if (patch.note !== undefined) fields.push({ column: 'note', value: patch.note })
  const update = buildDynamicUpdate('check_ins', id, fields, {
    defaultClauses: ['updated_at = NOW()'],
    returning: 'id',
  })
  if (!update) return null
  const result = await query(user, update.sql, update.params)
  return (result.rowCount ?? 0) === 0 ? null : getCheckIn(user, id)
}

/** Marks the check-in deleted or live again; false when it was not in the other state. */
export const setCheckInDeleted = async (user: string, id: string, deleted: boolean): Promise<boolean> => {
  const result = await query(
    user,
    deleted
      ? `UPDATE check_ins SET deleted_at = NOW(), logged = '{}', updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`
      : `UPDATE check_ins SET deleted_at = NULL, updated_at = NOW() WHERE id = $1 AND deleted_at IS NOT NULL`,
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

/** The live check-ins of a form answered in [from, to) or scheduled for a slot in it. */
export const listFormCheckInsBetween = async (
  user: string,
  formId: string,
  from: Date,
  to: Date,
): Promise<SlotCheckInRecord[]> => {
  const result = await query<SlotCheckInRecord>(
    user,
    `SELECT id, status, answered_at, scheduled_for, answers FROM check_ins
     WHERE form_id = $1 AND deleted_at IS NULL
       AND ((answered_at >= $2 AND answered_at < $3) OR (scheduled_for >= $2 AND scheduled_for < $3))
     ORDER BY answered_at, id`,
    [formId, from, to],
  )
  return result.rows
}

/**
 * Hard-deletes the live skips of a slot, which an answer to the slot replaces. Resolves to how many
 * it deleted.
 */
export const deleteSkippedCheckIns = async (
  user: string,
  formId: string,
  scheduledFor: Date,
): Promise<number> => {
  const result = await query(
    user,
    `DELETE FROM check_ins
     WHERE form_id = $1 AND scheduled_for = $2 AND status = 'skipped' AND deleted_at IS NULL`,
    [formId, scheduledFor],
  )
  return result.rowCount ?? 0
}

/**
 * Hard-deletes the `check_in` points a check-in wrote. Not a soft delete: a tombstone would keep
 * `insertTimeSeries` from writing the same point again when the check-in is restored or re-saved.
 */
export const deleteCheckInPoints = async (
  user: string,
  points: readonly CheckInLoggedPoint[],
): Promise<number> => {
  if (points.length === 0) return 0
  const result = await query(
    user,
    `DELETE FROM time_series t
     USING unnest($1::text[], $2::timestamptz[]) AS p(metric, time)
     WHERE t.metric = p.metric AND t.time = p.time AND t.source = 'check_in'`,
    [points.map((point) => point.metric), points.map((point) => point.time)],
  )
  return result.rowCount ?? 0
}

/** Purges check-ins and forms deleted before `before`; a purged form takes its versions and check-ins with it. */
export const purgeDeletedCheckIns = async (
  user: string,
  before: Date,
): Promise<{ check_ins: number; forms: number }> =>
  withUserTransaction(user, async (tx) => {
    const checkIns = await query(tx, 'DELETE FROM check_ins WHERE deleted_at < $1', [before])
    const forms = await query(tx, 'DELETE FROM check_in_forms WHERE deleted_at < $1', [before])
    return { check_ins: checkIns.rowCount ?? 0, forms: forms.rowCount ?? 0 }
  })

const lockTurns = new Map<string, Promise<void>>()

/**
 * One lock holder per user in this process. A waiter on the advisory lock holds a pooled
 * connection, so waiters queued in the database could starve the holder of the connections its
 * own statements need; queued here they hold none.
 */
const inUserTurn = <T>(user: string, fn: () => Promise<T>): Promise<T> => {
  const run = (lockTurns.get(user) ?? Promise.resolve()).then(fn)
  const settled = run.then(
    () => undefined,
    () => undefined,
  )
  lockTurns.set(user, settled)
  void settled.then(() => {
    if (lockTurns.get(user) === settled) lockTurns.delete(user)
  })
  return run
}

/**
 * Runs `fn` as the only writer of the form and its check-ins: the form's advisory lock keeps other
 * processes out, and within this process the user's check-in writes take turns. The transaction
 * only carries the lock: `fn`'s statements run on other pooled connections. Not re-entrant: a
 * nested call for the same user waits forever.
 */
export const withCheckInFormLock = <T>(user: string, formId: string, fn: () => Promise<T>): Promise<T> =>
  inUserTurn(user, () =>
    withUserTransaction(user, async (tx) => {
      await query(tx, 'SELECT pg_advisory_xact_lock(hashtext($1))', [`check_in_form:${formId}`])
      return fn()
    }),
  )

/**
 * The aurboda overrides all of whose targets are among `activityIds`: the live ones, or with
 * `deletedSince` those soft-deleted at or after it.
 */
export const listOverridesOfActivities = async (
  user: string,
  activityIds: readonly string[],
  deletedSince?: Date,
): Promise<string[]> => {
  if (activityIds.length === 0) return []
  const result = await query<{ id: string }>(
    user,
    `SELECT o.id FROM activities o
     JOIN activity_override_targets t ON t.override_id = o.id
     WHERE o.source = 'aurboda'
       AND ${deletedSince ? 'o.deleted_at >= $2' : 'o.deleted_at IS NULL'}
     GROUP BY o.id
     HAVING bool_and(t.target_id = ANY($1::uuid[]))
     ORDER BY o.id`,
    deletedSince ? [activityIds, deletedSince] : [activityIds],
  )
  return result.rows.map((row) => row.id)
}
