/**
 * Merge adjacent/overlapping productivity records into continuous spans.
 *
 * Records sharing the same resolved_category (or both uncategorized) are merged
 * when they overlap or are within a short gap. This prevents dozens of tiny
 * window-level ActivityWatch records from creating a mess of lanes on the timeline.
 */
import type { ProductivityRecord } from '../../state/api'

/**
 * Group key for merging productivity records.
 * Records with the same category path are merged together.
 * Uncategorized records share a common empty-string key.
 */
export const productivityGroupKey = (p: ProductivityRecord): string =>
  p.resolved_category && p.resolved_category.length > 0 ? p.resolved_category.join(' > ') : ''

/** Gap threshold for merging adjacent same-category records (2 minutes). */
export const MERGE_GAP_MS = 2 * 60 * 1000

export interface MergedProductivitySpan {
  start: Date
  end: Date
  groupKey: string
  records: ProductivityRecord[]
}

/**
 * Merge adjacent/overlapping productivity records that share the same category.
 * Adjacent records within MERGE_GAP_MS are merged into a single span.
 */
export const mergeProductivitySpans = (productivity: ProductivityRecord[]): MergedProductivitySpan[] => {
  if (productivity.length === 0) return []

  // Sort by start time
  const sorted = [...productivity].sort((a, b) => a.start_time.getTime() - b.start_time.getTime())

  const spans: MergedProductivitySpan[] = []
  // Track open spans per group key
  const openSpans = new Map<string, MergedProductivitySpan>()

  for (const record of sorted) {
    const key = productivityGroupKey(record)
    const open = openSpans.get(key)

    if (open && record.start_time.getTime() <= open.end.getTime() + MERGE_GAP_MS) {
      // Extend the existing span
      if (record.end_time > open.end) open.end = record.end_time
      open.records.push(record)
    } else {
      // Close the previous span for this group (if any) and start a new one
      if (open) spans.push(open)
      const newSpan: MergedProductivitySpan = {
        end: record.end_time,
        groupKey: key,
        records: [record],
        start: record.start_time,
      }
      openSpans.set(key, newSpan)
    }
  }

  // Close all remaining open spans
  for (const span of openSpans.values()) spans.push(span)

  return spans.sort((a, b) => a.start.getTime() - b.start.getTime())
}
