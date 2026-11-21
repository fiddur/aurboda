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

const contribution = ({ count, end, start }: StepRecord, from: number, to: number): number => {
  const recordStart = start.getTime()
  const recordEnd = end.getTime()
  const length = recordEnd - recordStart
  if (length <= 0) return recordStart >= from && recordStart <= to ? count : 0
  const overlap = Math.min(recordEnd, to) - Math.max(recordStart, from)
  return overlap > 0 ? (count * overlap) / length : 0
}

/** undefined when no record overlaps the span or the sum rounds to 0. */
export const stepsFromRecords = (records: StepRecord[], start: Date, end: Date): number | undefined => {
  const from = start.getTime()
  const to = end.getTime()
  const total = latestPerSpan(records).reduce((sum, record) => sum + contribution(record, from, to), 0)
  const steps = Math.round(total)
  return steps > 0 ? steps : undefined
}
