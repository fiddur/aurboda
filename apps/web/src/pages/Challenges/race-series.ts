import type { ChallengeSpec, ChallengeStanding } from '@aurboda/api-spec'

import type { LineSeriesData } from '../../components/charts/TrendLineChart'

type BucketSize = ChallengeSpec['bucket_size']

/**
 * Format an ISO instant as a date in the given IANA timezone, falling back to the
 * viewer's locale timezone if it is invalid. The backend only validates `timezone` as
 * a non-empty string, so a crafted challenge could carry garbage — without this guard
 * `toLocaleDateString` throws `RangeError` and takes down the whole public render.
 */
export const formatDateInZone = (iso: string, timeZone: string): string => {
  try {
    return new Date(iso).toLocaleDateString(undefined, { timeZone })
  } catch {
    return new Date(iso).toLocaleDateString()
  }
}

/** Advance an ISO instant by one bucket, returning that bucket's exclusive end. */
export const bucketEnd = (bucketStartIso: string, bucketSize: BucketSize): string => {
  const d = new Date(bucketStartIso)
  if (bucketSize === '1M') d.setUTCMonth(d.getUTCMonth() + 1)
  else if (bucketSize === '1w') d.setUTCDate(d.getUTCDate() + 7)
  else d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

/**
 * Build a cumulative (running-total) "race" series from a member's per-bucket values.
 * Every racer starts at 0 on the start line, and each cumulative total is plotted at
 * its bucket's end (the total reached by then). Seeding the start-line point means the
 * chart draws a proper rising line as soon as there is a single bucket — so it renders
 * even a few hours into the challenge with only one member.
 */
export const toCumulativeSeries = (
  standing: ChallengeStanding,
  color: string,
  startTs: string,
  bucketSize: BucketSize,
): LineSeriesData => {
  const sorted = [...standing.buckets].sort((a, b) => a.bucket_start.localeCompare(b.bucket_start))
  const data = [{ date: startTs, value: 0 }]
  let running = 0
  for (const b of sorted) {
    running += b.value
    data.push({ date: bucketEnd(b.bucket_start, bucketSize), value: running })
  }
  return { color, data, name: standing.display_name }
}
