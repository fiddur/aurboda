import { query } from './connection.ts'
import { buildDynamicUpdate, type UpdateEntry } from './dynamic-update.ts'

export interface ReminderRecord {
  id: string
  title: string
  body: string | null
  link: string | null
  time_of_day: string
  weekdays: number[]
  enabled: boolean
  not_before: Date
  created_at: Date
  updated_at: Date
}

export interface ReminderInsert {
  title: string
  body?: string | null
  link?: string | null
  time_of_day: string
  weekdays: number[]
  enabled: boolean
  not_before: Date
}

export interface ReminderPatch {
  title?: string
  body?: string | null
  link?: string | null
  time_of_day?: string
  weekdays?: number[]
  enabled?: boolean
  not_before?: Date
}

const REMINDER_COLUMNS =
  'id, title, body, link, time_of_day, weekdays, enabled, not_before, created_at, updated_at'

export const normalizeWeekdays = (weekdays: readonly number[]): number[] =>
  [...new Set(weekdays)].sort((a, b) => a - b)

export const listReminders = async (user: string): Promise<ReminderRecord[]> => {
  const result = await query<ReminderRecord>(
    user,
    `SELECT ${REMINDER_COLUMNS} FROM reminders ORDER BY time_of_day, created_at, id`,
  )
  return result.rows
}

export const getReminder = async (user: string, id: string): Promise<ReminderRecord | null> => {
  const result = await query<ReminderRecord>(
    user,
    `SELECT ${REMINDER_COLUMNS} FROM reminders WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

export const insertReminder = async (user: string, input: ReminderInsert): Promise<ReminderRecord> => {
  const result = await query<ReminderRecord>(
    user,
    `INSERT INTO reminders (title, body, link, time_of_day, weekdays, enabled, not_before)
     VALUES ($1, $2, $3, $4, $5::smallint[], $6, $7)
     RETURNING ${REMINDER_COLUMNS}`,
    [
      input.title,
      input.body ?? null,
      input.link ?? null,
      input.time_of_day,
      normalizeWeekdays(input.weekdays),
      input.enabled,
      input.not_before,
    ],
  )
  return result.rows[0]!
}

/** Null when there is no such reminder. */
export const updateReminder = async (
  user: string,
  id: string,
  patch: ReminderPatch,
): Promise<ReminderRecord | null> => {
  const fields: UpdateEntry[] = []
  if (patch.title !== undefined) fields.push({ column: 'title', value: patch.title })
  if (patch.body !== undefined) fields.push({ column: 'body', value: patch.body })
  if (patch.link !== undefined) fields.push({ column: 'link', value: patch.link })
  if (patch.time_of_day !== undefined) fields.push({ column: 'time_of_day', value: patch.time_of_day })
  if (patch.weekdays !== undefined) {
    fields.push({ expression: 'weekdays = $NEXT::smallint[]', values: [normalizeWeekdays(patch.weekdays)] })
  }
  if (patch.enabled !== undefined) fields.push({ column: 'enabled', value: patch.enabled })
  if (patch.not_before !== undefined) fields.push({ column: 'not_before', value: patch.not_before })
  const update = buildDynamicUpdate('reminders', id, fields, {
    defaultClauses: ['updated_at = NOW()'],
    returning: REMINDER_COLUMNS,
  })
  if (!update) return getReminder(user, id)
  const result = await query<ReminderRecord>(user, update.sql, update.params)
  return result.rows[0] ?? null
}

export const deleteReminder = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, 'DELETE FROM reminders WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}
