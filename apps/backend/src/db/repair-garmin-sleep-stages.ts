import type { SleepData } from '@fiddur/garmin-connect/dist/garmin/types/sleep'

import type { Queryable } from './pool.ts'

import { garminSleepLevelsToStages } from '../integrations/garmin/sleep-stages.ts'
import {
  GARMIN_HC_ORIGIN,
  garminSleepExternalId,
  isoOffsetMs,
  localCalendarDate,
} from '../services/source-identity.ts'

/** Keys a Health Connect `SleepSessionRecord` upload merges into the shared Garmin sleep row. */
const HC_SLEEP_KEYS = ['stages', 'startTime', 'endTime', 'metadata', 'title', 'notes'] as const

interface SleepRow {
  id: string
  external_id: string
  data: Record<string, unknown>
}

/**
 * The row a Garmin-written HC sleep payload belongs to, by the same rule
 * `resolveHealthConnectIdentity` now applies; null when it carries no usable key.
 */
const correctExternalId = (data: Record<string, unknown>): string | null => {
  const metadata = data.metadata as Record<string, unknown> | undefined
  const clientRecordId = metadata?.clientRecordId
  if (typeof clientRecordId !== 'string' || !/^\d+$/.test(clientRecordId)) return null
  const offset = typeof data.startTime === 'string' ? (isoOffsetMs(data.startTime) ?? 0) : 0
  return garminSleepExternalId(localCalendarDate(Number(clientRecordId), offset))
}

const pickHcPayload = (data: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(HC_SLEEP_KEYS.filter((key) => key in data).map((key) => [key, data[key]]))

const withoutHcPayload = (data: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(data).filter(([key]) => !(HC_SLEEP_KEYS as readonly string[]).includes(key)),
  )

/**
 * Final `data` for every Garmin sleep row whose Health Connect payload was
 * filed under the previous night (UTC-derived calendar date), computed from
 * one snapshot so a row that both loses its foreign payload and receives the
 * right one is written once.
 * @internal Exported for testing.
 */
export const planHcPayloadMoves = (rows: SleepRow[]): Map<string, Record<string, unknown>> => {
  const byExternalId = new Map(rows.map((row) => [row.external_id, row]))
  const sources = new Set<string>()
  const incoming = new Map<string, Record<string, unknown>>()

  for (const row of rows) {
    if ((row.data.metadata as Record<string, unknown> | undefined)?.dataOrigin !== GARMIN_HC_ORIGIN) continue
    const target = correctExternalId(row.data)
    if (!target || target === row.external_id) continue
    sources.add(row.id)
    const targetRow = byExternalId.get(target)
    if (targetRow) incoming.set(targetRow.id, pickHcPayload(row.data))
  }

  const updates = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const isSource = sources.has(row.id)
    const payload = incoming.get(row.id)
    if (!isSource && !payload) continue
    updates.set(row.id, { ...(isSource ? withoutHcPayload(row.data) : row.data), ...payload })
  }
  return updates
}

const hasStages = (data: Record<string, unknown>): boolean =>
  Array.isArray(data.stages) && data.stages.length > 0

const RAW_BATCH_SIZE = 200

/**
 * One-off repair (#1080 follow-up): moves Health Connect sleep payloads that
 * the UTC calendar-date bug filed one night early onto their own row, then
 * fills a stage timeline from the stored Garmin `sleepLevels` for rows still
 * without one. Idempotent; `start_time`/`end_time` are left alone. Run it on a
 * transaction handle: the moves are computed from one snapshot.
 */
export const repairGarminSleepStages = async (db: Queryable): Promise<void> => {
  const { rows } = await db.query<SleepRow>(
    `SELECT id, external_id, data FROM activities
        WHERE source = 'garmin' AND activity_type = 'sleep' AND deleted_at IS NULL
          AND external_id LIKE 'garmin-sleep-%'`,
  )

  const updates = planHcPayloadMoves(rows)
  for (const [id, data] of updates) {
    await db.query(`UPDATE activities SET data = $2::jsonb WHERE id = $1`, [id, JSON.stringify(data)])
  }

  const stageless = rows
    .map((row) => ({ ...row, data: updates.get(row.id) ?? row.data }))
    .filter((row) => !hasStages(row.data))
  for (let i = 0; i < stageless.length; i += RAW_BATCH_SIZE) {
    const batch = stageless.slice(i, i + RAW_BATCH_SIZE)
    const raw = await db.query<{ external_id: string; sleep_levels: SleepData['sleepLevels'] }>(
      `SELECT external_id, data->'sleepLevels' AS sleep_levels
           FROM raw_records
          WHERE source = 'garmin' AND record_type = 'garmin_sleep' AND external_id = ANY($1::text[])`,
      [batch.map((row) => row.external_id)],
    )
    const levelsByExternalId = new Map(raw.rows.map((r) => [r.external_id, r.sleep_levels]))
    for (const row of batch) {
      const levels = levelsByExternalId.get(row.external_id)
      const stages = garminSleepLevelsToStages(Array.isArray(levels) ? levels : null)
      if (stages.length === 0) continue
      await db.query(
        `UPDATE activities SET data = data || jsonb_build_object('stages', $2::jsonb) WHERE id = $1`,
        [row.id, JSON.stringify(stages)],
      )
    }
  }
}
