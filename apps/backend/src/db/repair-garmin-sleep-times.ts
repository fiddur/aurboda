import type { Queryable } from './pool.ts'

import { GARMIN_HC_ORIGIN } from '../services/source-identity.ts'
import { correctExternalId } from './repair-garmin-sleep-stages.ts'

interface Span {
  start: Date
  end: Date
}

export interface SleepTimesRow {
  id: string
  external_id: string
  start_time: Date
  end_time: Date | null
  data: Record<string, unknown>
}

export interface SyncedSleepNote {
  id: string
  entity_id: string
  start_time: Date | null
  end_time: Date | null
  updated_at: Date
}

export interface SleepNotePlan {
  /** note id → the activity id it belongs on */
  moves: Map<string, string>
  /** note id → the note already on its activity that it duplicates */
  duplicates: Map<string, string>
}

export interface SleepTimesRepairResult {
  rows: number
  notes: number
}

const toDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const spanOf = (start: unknown, end: unknown): Span | null => {
  const startDate = toDate(start)
  const endDate = toDate(end)
  return startDate && endDate && startDate < endDate ? { end: endDate, start: startDate } : null
}

/** The span of a Garmin-written HC payload filed under its own night. */
const payloadSpan = (row: SleepTimesRow): Span | null => {
  const metadata = row.data.metadata as Record<string, unknown> | undefined
  if (metadata?.dataOrigin !== GARMIN_HC_ORIGIN) return null
  if (correctExternalId(row.data) !== row.external_id) return null
  return spanOf(row.data.startTime, row.data.endTime)
}

const currentSpan = (row: SleepTimesRow): Span => ({
  end: row.end_time ?? row.start_time,
  start: row.start_time,
})

const overlaps = (a: Span, b: Span): boolean => a.start < b.end && b.start < a.end

/** A note without an end still meets the row its start falls in. */
const noteSpan = (note: SyncedSleepNote, start: Date): Span => ({
  end: note.end_time && note.end_time > start ? note.end_time : new Date(start.getTime() + 1),
  start,
})

/**
 * New times for every Garmin sleep row that holds another night's span: the
 * misfiled Health Connect upserts overwrote `start_time`/`end_time` with the
 * neighbouring night's. The right span is the stored Garmin `dailySleepDTO`,
 * which Garmin keys by its own calendar date; the row's HC payload only stands
 * in where there is none, because a payload from an app that sent no
 * `startZoneOffset` sits on the previous night's row beyond +12h. A row
 * overlapping its right span is left as is, so ordinary differences between
 * the two sources are not churned.
 * @internal Exported for testing.
 */
export const planSleepTimeFixes = (
  rows: SleepTimesRow[],
  garminSpans: Map<string, Span>,
): Map<string, Span> => {
  const fixes = new Map<string, Span>()
  for (const row of rows) {
    const correct = garminSpans.get(row.external_id) ?? payloadSpan(row)
    if (!correct || overlaps(currentSpan(row), correct)) continue
    fixes.set(row.id, correct)
  }
  return fixes
}

/**
 * Health Connect synced notes to put back on the sleep row whose (repaired)
 * span overlaps the note's. A note moves only when its own row does not
 * overlap it and exactly one other row does. When that row already carries a
 * synced note that stays, the moving one is a stale copy of it.
 * @internal Exported for testing.
 */
export const planSleepNoteMoves = (
  rows: SleepTimesRow[],
  fixes: Map<string, Span>,
  notes: SyncedSleepNote[],
): SleepNotePlan => {
  const spanned = rows.map((row) => ({ id: row.id, span: fixes.get(row.id) ?? currentSpan(row) }))
  const spans = new Map(spanned.map(({ id, span }) => [id, span]))
  const targetOf = (note: SyncedSleepNote): string | null => {
    const home = spans.get(note.entity_id)
    if (!note.start_time || !home) return null
    const span = noteSpan(note, note.start_time)
    if (overlaps(home, span)) return null
    const candidates = spanned.filter((row) => row.id !== note.entity_id && overlaps(row.span, span))
    return candidates.length === 1 ? candidates[0].id : null
  }

  const misplaced = notes
    .map((note) => ({ note, target: targetOf(note) }))
    .filter((entry): entry is { note: SyncedSleepNote; target: string } => entry.target !== null)
  const moving = new Set(misplaced.map(({ note }) => note.id))
  const occupant = new Map<string, string>()
  for (const note of notes) {
    if (!moving.has(note.id) && !occupant.has(note.entity_id)) occupant.set(note.entity_id, note.id)
  }

  const plan: SleepNotePlan = { duplicates: new Map(), moves: new Map() }
  misplaced.sort(
    (a, b) => b.note.updated_at.getTime() - a.note.updated_at.getTime() || a.note.id.localeCompare(b.note.id),
  )
  for (const { note, target } of misplaced) {
    const kept = occupant.get(target)
    if (kept) {
      plan.duplicates.set(note.id, kept)
    } else {
      plan.moves.set(note.id, target)
      occupant.set(target, note.id)
    }
  }
  return plan
}

const RAW_BATCH_SIZE = 200

const garminSpansFor = async (db: Queryable, externalIds: string[]): Promise<Map<string, Span>> => {
  const spans = new Map<string, Span>()
  for (let i = 0; i < externalIds.length; i += RAW_BATCH_SIZE) {
    const raw = await db.query<{ external_id: string; start_ms: unknown; end_ms: unknown }>(
      `SELECT external_id,
              data->'dailySleepDTO'->'sleepStartTimestampGMT' AS start_ms,
              data->'dailySleepDTO'->'sleepEndTimestampGMT' AS end_ms
         FROM raw_records
        WHERE source = 'garmin' AND record_type = 'garmin_sleep' AND external_id = ANY($1::text[])`,
      [externalIds.slice(i, i + RAW_BATCH_SIZE)],
    )
    for (const row of raw.rows) {
      const span = typeof row.start_ms === 'number' ? spanOf(row.start_ms, row.end_ms) : null
      if (span) spans.set(row.external_id, span)
    }
  }
  return spans
}

/**
 * One-off repair (#1173), after `repairGarminSleepStages`: puts back the
 * `start_time`/`end_time` and the Health Connect synced note of Garmin sleep
 * rows that a misfiled HC upload overwrote with the neighbouring night's.
 * Idempotent. Both plans are computed from rows read once up front; run it on
 * a transaction handle so the time and note updates commit together.
 */
export const repairGarminSleepTimes = async (db: Queryable): Promise<SleepTimesRepairResult> => {
  const { rows } = await db.query<SleepTimesRow>(
    `SELECT id, external_id, start_time, end_time, data FROM activities
        WHERE source = 'garmin' AND activity_type = 'sleep' AND deleted_at IS NULL
          AND external_id LIKE 'garmin-sleep-%'`,
  )
  if (rows.length === 0) return { notes: 0, rows: 0 }

  const garminSpans = await garminSpansFor(
    db,
    rows.map((row) => row.external_id),
  )
  const fixes = planSleepTimeFixes(rows, garminSpans)
  for (const [id, span] of fixes) {
    await db.query(`UPDATE activities SET start_time = $2, end_time = $3 WHERE id = $1`, [
      id,
      span.start,
      span.end,
    ])
  }

  const notes = await db.query<SyncedSleepNote>(
    `SELECT id, entity_id, start_time, end_time, updated_at FROM notes
        WHERE entity_type = 'activity' AND source = 'health_connect' AND entity_id = ANY($1::text[])`,
    [rows.map((row) => row.id)],
  )
  const { moves, duplicates } = planSleepNoteMoves(rows, fixes, notes.rows)
  for (const [id, target] of moves) {
    await db.query(`UPDATE notes SET entity_id = $2, updated_at = NOW() WHERE id = $1`, [id, target])
  }
  for (const [id, kept] of duplicates) {
    await db.query(`UPDATE notes SET entity_id = $2 WHERE entity_type = 'note' AND entity_id = $1`, [
      id,
      kept,
    ])
    await db.query(`DELETE FROM notes WHERE id = $1`, [id])
  }

  return { notes: moves.size + duplicates.size, rows: fixes.size }
}
