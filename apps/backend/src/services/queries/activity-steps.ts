import type { StepRecord } from '../../db/index.ts'

const latestPerSpan = (records: StepRecord[]): StepRecord[] => {
  const bySpan = new Map<string, StepRecord>()
  for (const record of records) {
    const key = `${record.start.getTime()}|${record.end.getTime()}`
    const kept = bySpan.get(key)
    const replaces =
      !kept || !kept.modified || !record.modified || record.modified.getTime() >= kept.modified.getTime()
    if (replaces) bySpan.set(key, record)
  }
  return [...bySpan.values()]
}

type Interval = [number, number]

const coveredLength = (covered: Interval[], from: number, to: number): number =>
  covered.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0)

/** Union of the covered intervals with [from, to], kept disjoint so lengths add up. */
const cover = (covered: Interval[], from: number, to: number): Interval[] => {
  const touching = covered.filter(([a, b]) => a <= to && b >= from)
  const merged: Interval = [
    Math.min(from, ...touching.map(([a]) => a)),
    Math.max(to, ...touching.map(([, b]) => b)),
  ]
  return [...covered.filter((i) => !touching.includes(i)), merged]
}

const spanOf = ({ end, start }: StepRecord): number => end.getTime() - start.getTime()

/**
 * Overlapping records of different spans (minute records beside an hourly one) would count the
 * same steps twice, so each instant counts once, from the finest record covering it.
 */
const uniqueSteps = (records: StepRecord[], from: number, to: number): number => {
  const spans = records
    .filter((r) => spanOf(r) > 0)
    .toSorted((a, b) => spanOf(a) - spanOf(b) || a.start.getTime() - b.start.getTime())
  const { covered, total } = spans.reduce(
    (acc, { count, end, start }) => {
      const recordStart = start.getTime()
      const recordEnd = end.getTime()
      const lo = Math.max(recordStart, from)
      const hi = Math.min(recordEnd, to)
      const fresh = hi > lo ? hi - lo - coveredLength(acc.covered, lo, hi) : 0
      return {
        covered: cover(acc.covered, recordStart, recordEnd),
        total: acc.total + (fresh > 0 ? (count * fresh) / (recordEnd - recordStart) : 0),
      }
    },
    { covered: [] as Interval[], total: 0 },
  )
  const points = records
    .filter((r) => spanOf(r) <= 0)
    .filter(({ start }) => {
      const at = start.getTime()
      return at >= from && at <= to && !covered.some(([a, b]) => at > a && at < b)
    })
  return points.reduce((sum, { count }) => sum + count, total)
}

/** undefined when no record overlaps the span or the sum rounds to 0. */
export const stepsFromRecords = (records: StepRecord[], start: Date, end: Date): number | undefined => {
  const steps = Math.round(uniqueSteps(latestPerSpan(records), start.getTime(), end.getTime()))
  return steps > 0 ? steps : undefined
}
