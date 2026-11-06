import format from 'pg-format'

import type { Queryable } from '../db/pool.ts'
import type { UsageKind, UsageRow } from './usage-recorder.ts'

export const USAGE_RETENTION_DAYS = 400

export const CREATE_USER_USAGE_DAILY_TABLE = `
  CREATE TABLE IF NOT EXISTS user_usage_daily (
    username VARCHAR(255) NOT NULL,
    day      DATE NOT NULL,
    kind     VARCHAR(10) NOT NULL,
    channel  VARCHAR(50) NOT NULL,
    count    INTEGER NOT NULL DEFAULT 0,
    items    INTEGER NOT NULL DEFAULT 0,
    last_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (username, day, kind, channel)
  )
`

export const CREATE_USER_USAGE_DAILY_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_user_usage_daily_day ON user_usage_daily (day)`,
]

export interface UsageSummaryRow {
  username: string
  kind: UsageKind
  channel: string
  count: number
  items: number
  active_days: number
  last_at: Date
}

export interface UserUsageApi {
  upsertUsageRows: (rows: UsageRow[]) => Promise<void>
  getUsageDaily: (params: { username?: string; since: Date }) => Promise<UsageRow[]>
  /** Totals per user, kind and channel over the days from `since` (UTC date) on. */
  getUsageSummary: (since: Date) => Promise<UsageSummaryRow[]>
  /** Deletes the days before `day`'s UTC date. Resolves to the number of rows deleted. */
  pruneUsageBefore: (day: Date) => Promise<number>
}

const utcDate = (date: Date): string => date.toISOString().slice(0, 10)

const mapDailyRow = (row: Record<string, unknown>): UsageRow => ({
  channel: row.channel as string,
  count: row.count as number,
  day: row.day as string,
  items: row.items as number,
  kind: row.kind as UsageKind,
  last_at: new Date(row.last_at as string),
  username: row.username as string,
})

export const createUserUsageApi = (getClient: () => Promise<Queryable>): UserUsageApi => ({
  getUsageDaily: async ({ username, since }) => {
    const client = await getClient()
    const params: unknown[] = [utcDate(since)]
    if (username !== undefined) params.push(username)
    const result = await client.query(
      `SELECT username, day::text AS day, kind, channel, count, items, last_at
       FROM user_usage_daily
       WHERE day >= $1::date${username !== undefined ? ' AND username = $2' : ''}
       ORDER BY username, day, kind, channel`,
      params,
    )
    return result.rows.map(mapDailyRow)
  },

  getUsageSummary: async (since) => {
    const client = await getClient()
    const result = await client.query(
      `SELECT username, kind, channel,
              SUM(count)::bigint AS count,
              SUM(items)::bigint AS items,
              COUNT(DISTINCT day)::int AS active_days,
              MAX(last_at) AS last_at
       FROM user_usage_daily
       WHERE day >= $1::date
       GROUP BY username, kind, channel
       ORDER BY username, kind, channel`,
      [utcDate(since)],
    )
    return result.rows.map((row) => ({
      active_days: row.active_days as number,
      channel: row.channel as string,
      count: Number(row.count),
      items: Number(row.items),
      kind: row.kind as UsageKind,
      last_at: new Date(row.last_at as string),
      username: row.username as string,
    }))
  },

  pruneUsageBefore: async (day) => {
    const client = await getClient()
    const result = await client.query('DELETE FROM user_usage_daily WHERE day < $1::date', [utcDate(day)])
    return result.rowCount ?? 0
  },

  upsertUsageRows: async (rows) => {
    if (rows.length === 0) return
    const client = await getClient()
    await client.query(
      format(
        `INSERT INTO user_usage_daily (username, day, kind, channel, count, items, last_at)
         VALUES %L
         ON CONFLICT (username, day, kind, channel) DO UPDATE SET
           count = user_usage_daily.count + EXCLUDED.count,
           items = user_usage_daily.items + EXCLUDED.items,
           last_at = GREATEST(user_usage_daily.last_at, EXCLUDED.last_at)`,
        rows.map((r) => [r.username, r.day, r.kind, r.channel, r.count, r.items, r.last_at]),
      ),
    )
  },
})
