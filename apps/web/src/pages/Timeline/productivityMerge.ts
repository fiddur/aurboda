/**
 * Merge adjacent/overlapping productivity records into continuous spans.
 *
 * Records sharing the same resolved_category (or both uncategorized) are merged
 * when they overlap or are within a short gap. This prevents dozens of tiny
 * window-level ActivityWatch records from creating a mess of lanes on the timeline.
 *
 * After per-subcategory merging, overlapping subcategory spans from the same
 * parent category are promoted to the parent level (e.g. interleaved
 * "Work > Programming" and "Work > Communication" become "Work").
 */
import type { ProductivityRecord } from '../../state/api'

/**
 * Group key for merging productivity records.
 * Records with the same category path are merged together.
 * Uncategorized records share a common empty-string key.
 */
export const productivityGroupKey = (p: ProductivityRecord): string =>
  p.resolved_category && p.resolved_category.length > 0 ? p.resolved_category.join(' > ') : ''

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
 * Promote overlapping subcategory spans to their parent category.
 *
 * When spans from different subcategories of the same parent overlap or are
 * within gapMs of each other, they merge into a single parent-level span.
 * A solid block of a single subcategory (e.g. 2 hours of just "Programming")
 * stays at the subcategory level.
 */
export const promoteOverlappingSubcategories = (
  spans: MergedProductivitySpan[],
  gapMs: number,
): MergedProductivitySpan[] => {
  // Group by top-level category (only spans with depth > 1 are candidates)
  const byParent = new Map<string, MergedProductivitySpan[]>()
  const result: MergedProductivitySpan[] = []

  for (const span of spans) {
    const sepIdx = span.groupKey.indexOf(' > ')
    if (sepIdx === -1) {
      // Top-level or uncategorized — no promotion possible
      result.push(span)
      continue
    }
    const parent = span.groupKey.slice(0, sepIdx)
    const list = byParent.get(parent)
    if (list) list.push(span)
    else byParent.set(parent, [span])
  }

  for (const [parent, childSpans] of byParent) {
    childSpans.sort((a, b) => a.start.getTime() - b.start.getTime())

    // Sweep-line: merge overlapping/adjacent spans, tracking if multiple subcategories contributed
    let currentStart = childSpans[0]!.start
    let currentEnd = childSpans[0]!.end
    let currentKey = childSpans[0]!.groupKey
    let currentRecords = [...childSpans[0]!.records]
    let multipleSubcats = false

    for (let i = 1; i < childSpans.length; i++) {
      const next = childSpans[i]!
      if (next.start.getTime() <= currentEnd.getTime() + gapMs) {
        // Overlapping/adjacent — merge
        if (next.groupKey !== currentKey) multipleSubcats = true
        if (next.end > currentEnd) currentEnd = next.end
        currentRecords.push(...next.records)
      } else {
        // Emit current span
        result.push({
          end: currentEnd,
          groupKey: multipleSubcats ? parent : currentKey,
          records: currentRecords,
          start: currentStart,
        })
        currentStart = next.start
        currentEnd = next.end
        currentKey = next.groupKey
        currentRecords = [...next.records]
        multipleSubcats = false
      }
    }
    result.push({
      end: currentEnd,
      groupKey: multipleSubcats ? parent : currentKey,
      records: currentRecords,
      start: currentStart,
    })
  }

  return result.sort((a, b) => a.start.getTime() - b.start.getTime())
}

/**
 * Merge adjacent/overlapping productivity records that share the same category.
 * Adjacent records within the merge gap are merged into a single span.
 *
 * @param mergeGapMs - Gap threshold in ms; records within this gap are merged (default 2 min).
 *
 * Uncategorized records that overlap with categorized spans are excluded to avoid
 * giant background blobs covering the entire day on the timeline.
 */
export const mergeProductivitySpans = (
  productivity: ProductivityRecord[],
  mergeGapMs = MERGE_GAP_MS,
): MergedProductivitySpan[] => {
  if (productivity.length === 0) return []

  // Sort by start time
  const sorted = [...productivity].sort((a, b) => a.start_time.getTime() - b.start_time.getTime())

  // Phase 1: Build categorized spans — group by key, merge adjacent within gap
  const byKey = new Map<string, ProductivityRecord[]>()
  const uncategorizedRecords: ProductivityRecord[] = []

  for (const record of sorted) {
    const key = productivityGroupKey(record)
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

  // Phase 2: Promote overlapping subcategory spans to parent level
  const promoted = promoteOverlappingSubcategories(categorizedSpans, mergeGapMs)

  // Phase 3: Filter uncategorized records — exclude those fully covered by a categorized span
  const visibleUncategorized = uncategorizedRecords.filter((record) => {
    const rs = record.start_time.getTime()
    const re = record.end_time.getTime()
    return !promoted.some((span) => span.start.getTime() <= rs && span.end.getTime() >= re)
  })

  // Phase 4: Merge the remaining uncategorized records
  const uncategorizedSpans = mergeAdjacentRecords(visibleUncategorized, mergeGapMs, '')

  return [...promoted, ...uncategorizedSpans].sort((a, b) => a.start.getTime() - b.start.getTime())
}
