/**
 * Pure mapping from a challenge post's structured payload (#994) to what the
 * native timeline card draws: the cumulative race series from the standings
 * snapshot's samples and the totals' display form. DOM-free so it runs under
 * the Node test runner.
 */
import type { FeedStructuredChallenge, QuantChallengeSample } from '@aurboda/api-spec'

import type { LineSeriesData } from '../../components/charts/TrendLineChart'

import { memberColor } from '../Challenges/member-colors'
import { formatTotal } from '../Challenges/spec-label'

const MIN_DRAWABLE_POINTS = 2

const UNIT_SECONDS: Record<string, number> = { d: 86_400, h: 3_600, m: 60, s: 1 }

/** A FEP bucket (`1d`, `15m`, …) in seconds, or null when it is not one. */
export const quantBucketSeconds = (bucket: string): number | null => {
  const match = /^(\d+)(s|m|h|d)$/.exec(bucket)
  return match ? Number(match[1]) * UNIT_SECONDS[match[2]] : null
}

const sampleValue = (sample: QuantChallengeSample, max: boolean): number =>
  max ? (sample.max ?? sample.sum ?? sample.avg ?? 0) : (sample.sum ?? sample.count ?? sample.avg ?? 0)

/**
 * One racing line per standings member, in leaderboard order: the start line
 * at 0, then the running total (best sample so far for a `max` challenge)
 * plotted at each bucket's end, as the live challenge page draws it.
 */
export const standingsRaceSeries = (structured: FeedStructuredChallenge): LineSeriesData[] => {
  const { challenge, standings } = structured
  if (standings == null) return []
  const start = Date.parse(challenge.startTime)
  if (Number.isNaN(start)) return []
  const bucketMs = (quantBucketSeconds(standings.bucket) ?? 0) * 1000
  const max = challenge.scoring === 'max'
  return standings.members
    .map((member, i) => {
      const data = [{ date: new Date(start).toISOString(), value: 0 }]
      let running = 0
      for (const sample of [...member.samples].sort((a, b) => a.offset - b.offset)) {
        const value = sampleValue(sample, max)
        running = max ? Math.max(running, value) : running + value
        data.push({ date: new Date(start + sample.offset * 1000 + bucketMs).toISOString(), value: running })
      }
      return { color: memberColor(i), data, name: member.name }
    })
    .filter((series) => series.data.length >= MIN_DRAWABLE_POINTS)
}

/** A member's total as the challenge page shows it, or with the wire unit when no Aurboda spec rode along. */
export const formatStandingTotal = (structured: FeedStructuredChallenge, total: number): string => {
  const spec = structured.challenge.aurboda?.spec
  if (spec) return formatTotal(spec, total)
  const unit = structured.challenge.unit
  return unit ? `${Math.round(total).toLocaleString()} ${unit}` : Math.round(total).toLocaleString()
}
