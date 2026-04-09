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
 *
 * When `depth` is provided, the category path is truncated to that depth,
 * allowing subcategories to merge into their parent (e.g. depth=1 merges
 * "Work > Programming" and "Work > Design" into "Work").
 */
export const productivityGroupKey = (p: ProductivityRecord, depth?: number): string =>
  p.resolved_category && p.resolved_category.length > 0
    ? (depth ? p.resolved_category.slice(0, depth) : p.resolved_category).join(' > ')
    : ''

/** Default gap threshold for merging adjacent same-category records (2 minutes). */
export const MERGE_GAP_MS = 2 * 60 * 1000

export interface MergedProductivitySpan {
  start: Date
  end: Date
  groupKey: string
  records: ProductivityRecord[]
}

/** Merge sorted records into spans using a gap threshold, assigning a common groupKey. */
const mergeAdjacentRecords = (
  records: ProductivityRecord[],
  gapMs: number,
  groupKey: string,
): MergedProductivitySpan[] => {
  const spans: MergedProductivitySpan[] = []
  let open: MergedProductivitySpan | null = null

  for (const record of records) {
    if (open && record.start_time.getTime() <= open.end.getTime() + gapMs) {
      if (record.end_time > open.end) open.end = record.end_time
      open.records.push(record)
    } else {
      if (open) spans.push(open)
      open = { end: record.end_time, groupKey, records: [record], start: record.start_time }
    }
  }
  if (open) spans.push(open)
  return spans
}

/**
 * Merge adjacent/overlapping productivity records that share the same category.
 * Adjacent records within the merge gap are merged into a single span.
 *
 * @param mergeGapMs - Gap threshold in ms; records within this gap are merged (default 2 min).
 * @param categoryDepth - When set, truncates category paths to this depth before grouping,
 *   so subcategories merge into their parent category.
 *
 * Uncategorized records that overlap with categorized spans are excluded to avoid
 * giant background blobs covering the entire day on the timeline.
 */
export const mergeProductivitySpans = (
  productivity: ProductivityRecord[],
  mergeGapMs = MERGE_GAP_MS,
  categoryDepth?: number,
): MergedProductivitySpan[] => {
  if (productivity.length === 0) return []

  // Sort by start time
  const sorted = [...productivity].sort((a, b) => a.start_time.getTime() - b.start_time.getTime())

  // Phase 1: Build categorized spans — group by key, merge adjacent within gap
  const byKey = new Map<string, ProductivityRecord[]>()
  const uncategorizedRecords: ProductivityRecord[] = []

  for (const record of sorted) {
    const key = productivityGroupKey(record, categoryDepth)
    if (key === '') {
      uncategorizedRecords.push(record)
    } else {
      const list = byKey.get(key)
      if (list) list.push(record)
      else byKey.set(key, [record])
    }
  }

  const categorizedSpans: MergedProductivitySpan[] = []
  for (const [key, records] of byKey) {
    categorizedSpans.push(...mergeAdjacentRecords(records, mergeGapMs, key))
  }

  // Phase 2: Filter uncategorized records — exclude those fully covered by a categorized span
  const visibleUncategorized = uncategorizedRecords.filter((record) => {
    const rs = record.start_time.getTime()
    const re = record.end_time.getTime()
    return !categorizedSpans.some((span) => span.start.getTime() <= rs && span.end.getTime() >= re)
  })

  // Phase 3: Merge the remaining uncategorized records
  const uncategorizedSpans = mergeAdjacentRecords(visibleUncategorized, mergeGapMs, '')

  return [...categorizedSpans, ...uncategorizedSpans].sort((a, b) => a.start.getTime() - b.start.getTime())
}
