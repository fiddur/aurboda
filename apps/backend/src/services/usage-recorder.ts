/**
 * Per-user, per-UTC-day usage counters, aggregated in memory and flushed to
 * the central `user_usage_daily` table. Recording never throws and never waits
 * on the database: a failed flush is logged and its rows are dropped.
 */

export type UsageKind = 'read' | 'write' | 'ingest'

export interface UsageRow {
  username: string
  /** UTC date, `YYYY-MM-DD`. */
  day: string
  kind: UsageKind
  channel: string
  count: number
  items: number
  last_at: Date
}

export interface UsageRecorder {
  record: (username: string, kind: UsageKind, channel: string, items?: number) => void
  flushNow: () => Promise<void>
  size: () => number
}

export interface UsageRecorderDeps {
  flush: (rows: UsageRow[]) => Promise<void>
  now?: () => Date
}

const MAX_CHANNEL_LENGTH = 50

export const createUsageRecorder = ({ flush, now = () => new Date() }: UsageRecorderDeps): UsageRecorder => {
  let pending = new Map<string, UsageRow>()

  return {
    flushNow: async () => {
      if (pending.size === 0) return
      const rows = [...pending.values()]
      pending = new Map()
      try {
        await flush(rows)
      } catch (error) {
        console.error(`⚠️ Failed to flush ${rows.length} usage row(s):`, error)
      }
    },

    record: (username, kind, channel, items = 1) => {
      const at = now()
      const day = at.toISOString().slice(0, 10)
      const ch = channel.slice(0, MAX_CHANNEL_LENGTH)
      const key = `${username}|${day}|${kind}|${ch}`
      const row = pending.get(key)
      if (row) {
        row.count += 1
        row.items += items
        if (at > row.last_at) row.last_at = at
      } else {
        pending.set(key, { channel: ch, count: 1, day, items, kind, last_at: at, username })
      }
    },

    size: () => pending.size,
  }
}

let installed: UsageRecorder | null = null

/** Installs the recorder that `recordUsage` forwards to; `null` uninstalls it. */
export const installUsageRecorder = (recorder: UsageRecorder | null): void => {
  installed = recorder
}

/** A no-op until a recorder is installed, so db functions stay usable without one. */
export const recordUsage = (username: string, kind: UsageKind, channel: string, items = 1): void => {
  installed?.record(username, kind, channel, items)
}

export const recordIngestBySource = <T>(
  username: string,
  rows: readonly T[],
  sourceOf: (row: T) => string,
): void => {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const source = sourceOf(row)
    counts.set(source, (counts.get(source) ?? 0) + 1)
  }
  for (const [source, n] of counts) recordUsage(username, 'ingest', source, n)
}

/** Returns a stop function. The interval is unref'd so it never holds the process open. */
export const startUsageFlushing = (recorder: UsageRecorder, intervalMs = 60_000): (() => void) => {
  const timer = setInterval(() => void recorder.flushNow(), intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
