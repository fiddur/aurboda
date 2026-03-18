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
 *
 * Uncategorized records that overlap with categorized spans are excluded to avoid
 * giant background blobs covering the entire day on the timeline.
 */
export const mergeProductivitySpans = (productivity: ProductivityRecord[]): MergedProductivitySpan[] => {
  if (productivity.length === 0) return []

  // Sort by start time
  const sorted = [...productivity].sort((a, b) => a.start_time.getTime() - b.start_time.getTime())

  // Phase 1: Build categorized spans first
  const categorizedSpans: MergedProductivitySpan[] = []
  const categorizedOpenSpans = new Map<string, MergedProductivitySpan>()
  const uncategorizedRecords: ProductivityRecord[] = []

  for (const record of sorted) {
    const key = productivityGroupKey(record)
    if (key === '') {
      uncategorizedRecords.push(record)
      continue
    }

    const open = categorizedOpenSpans.get(key)
    if (open && record.start_time.getTime() <= open.end.getTime() + MERGE_GAP_MS) {
      if (record.end_time > open.end) open.end = record.end_time
      open.records.push(record)
    } else {
      if (open) categorizedSpans.push(open)
      categorizedOpenSpans.set(key, {
        end: record.end_time,
        groupKey: key,
        records: [record],
        start: record.start_time,
      })
    }
  }
  for (const span of categorizedOpenSpans.values()) categorizedSpans.push(span)

  // Phase 2: Filter uncategorized records — exclude those fully covered by a categorized span
  const isFullyCovered = (record: ProductivityRecord): boolean => {
    const rs = record.start_time.getTime()
    const re = record.end_time.getTime()
    return categorizedSpans.some((span) => span.start.getTime() <= rs && span.end.getTime() >= re)
  }

  const visibleUncategorized = uncategorizedRecords.filter((r) => !isFullyCovered(r))

  // Phase 3: Merge the remaining uncategorized records
  const uncategorizedSpans: MergedProductivitySpan[] = []
  let openUncat: MergedProductivitySpan | null = null

  for (const record of visibleUncategorized) {
    if (openUncat && record.start_time.getTime() <= openUncat.end.getTime() + MERGE_GAP_MS) {
      if (record.end_time > openUncat.end) openUncat.end = record.end_time
      openUncat.records.push(record)
    } else {
      if (openUncat) uncategorizedSpans.push(openUncat)
      openUncat = {
        end: record.end_time,
        groupKey: '',
        records: [record],
        start: record.start_time,
      }
    }
  }
  if (openUncat) uncategorizedSpans.push(openUncat)

  return [...categorizedSpans, ...uncategorizedSpans].sort((a, b) => a.start.getTime() - b.start.getTime())
}
