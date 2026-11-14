import { query } from './connection.ts'

export interface TimeWindow {
  end: Date
  start: Date
}

/** The span of an activity whose `data.exclude_from_baseline` is true, whatever its type. */
export interface FlaggedWindow {
  activity_id: string
  activity_type: string
  end: Date
  start: Date
}

/** Flagged windows overlapping `[start, end)`, in start order. An activity without an end has no window. */
export const getFlaggedWindows = async (user: string, start: Date, end: Date): Promise<FlaggedWindow[]> => {
  const result = await query<{ activity_type: string; end_time: Date; id: string; start_time: Date }>(
    user,
    `SELECT id, activity_type, start_time, end_time
       FROM activities
      WHERE deleted_at IS NULL
        AND data @> '{"exclude_from_baseline": true}'::jsonb
        AND end_time IS NOT NULL
        AND start_time < $2
        AND end_time > $1
      ORDER BY start_time`,
    [start, end],
  )
  return result.rows.map((row) => ({
    activity_id: row.id,
    activity_type: row.activity_type,
    end: new Date(row.end_time),
    start: new Date(row.start_time),
  }))
}

/**
 * A condition that `column` lies in one of the windows bound as two parallel timestamptz arrays at
 * `startsParam` and `endsParam` (e.g. `$6`, `$7`); `windowParams` gives the arrays.
 */
export const inWindowsSql = (startsParam: string, endsParam: string, column = 'time'): string =>
  `EXISTS (SELECT 1 FROM unnest(${startsParam}::timestamptz[], ${endsParam}::timestamptz[]) AS fw(s, e)
                WHERE ${column} >= fw.s AND ${column} < fw.e)`

export const windowParams = (windows: TimeWindow[]): [Date[], Date[]] => [
  windows.map((w) => w.start),
  windows.map((w) => w.end),
]

/** Stored samples of `metrics` inside any of the windows, every source counted. */
export const countTimeSeriesInWindows = async (
  user: string,
  metrics: string[],
  windows: TimeWindow[],
): Promise<number> => {
  if (metrics.length === 0 || windows.length === 0) return 0
  const result = await query<{ n: number }>(
    user,
    `SELECT COUNT(*)::integer AS n
       FROM time_series
      WHERE metric = ANY($1) AND deleted_at IS NULL AND ${inWindowsSql('$2', '$3')}`,
    [metrics, ...windowParams(windows)],
  )
  return result.rows[0]?.n ?? 0
}
