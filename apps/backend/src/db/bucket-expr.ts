const truncUnits: Record<string, string> = {
  '1M': 'month',
  '1d': 'day',
  '1h': 'hour',
  '1w': 'week',
}

/**
 * Bucket starts come back as timestamptz. Calendar units and hours truncate in `tz` (PG's
 * three-argument `date_trunc`, which handles DST and half-hour offsets). Sub-hour bins stay on a
 * UTC origin: every current offset is a whole number of quarter hours (+05:45 included), so they
 * already fall on local clock boundaries, and binning local wall time instead would fold the
 * repeated DST hour into one bin.
 *
 * `tz` is only ever a bind value: `params` fill `$<startIdx>`, `$<startIdx + 1>`, ….
 */
export const buildBucketExpr = (
  bucketSize: string,
  column: string,
  startIdx: number,
  tz = 'UTC',
): { expr: string; params: string[] } => {
  const binIntervals: Record<string, string> = {
    '1m': '1 minute',
    '5m': '5 minutes',
    '15m': '15 minutes',
  }
  if (binIntervals[bucketSize]) {
    return {
      expr: `date_bin($${startIdx}::interval, ${column}, '2000-01-01T00:00:00Z'::timestamptz)`,
      params: [binIntervals[bucketSize]],
    }
  }
  return {
    expr: `date_trunc($${startIdx}::text, ${column}, $${startIdx + 1}::text)`,
    params: [truncUnits[bucketSize] ?? 'day', tz],
  }
}
