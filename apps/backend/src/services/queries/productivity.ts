/**
 * Productivity query functions.
 */

import type { CategoryInfo, ProductivityResult, SyncProvider } from './types.ts'

import { getProductivity, type ProductivityRecord, type ScreentimeCategory } from '../../db/index.ts'
import { getScreentimeCategories } from '../../db/screentime-categories.ts'
import { getCommentsMap } from './types.ts'

/**
 * Maximum gap (ms) between spans of the same activity that are still merged.
 * Applies both to directly consecutive spans and to spans separated by other
 * activities (interleave merging). 2 minutes covers RescueTime rounding gaps
 * and typical rapid window switches (e.g. terminal -> browser -> terminal).
 */
export const MERGE_GAP_MS = 2 * 60 * 1000

/** Internal type that tracks source IDs through the merge pipeline. */
type MergeRecord = ProductivityRecord & { source_ids: string[] }

/**
 * Merge productivity spans for the same activity/is_mobile, in two phases:
 *
 * Phase 1 -- sequential: adjacent spans of the same activity within MERGE_GAP_MS
 * are collapsed (handles RescueTime minute-boundary rounding).
 *
 * Phase 2 -- interleave: spans of the same activity separated only by short
 * bursts of other apps (total interleaved gap <= MERGE_GAP_MS) are merged into
 * a single span. duration_sec accumulates only the actual time in that app;
 * source_ids tracks all original record IDs that were consolidated.
 *
 * Records must arrive sorted by start_time (the DB query guarantees this).
 */
// eslint-disable-next-line complexity -- two-phase merge algorithm is inherently branchy
export function mergeProductivitySpans(
  records: ProductivityRecord[],
): (ProductivityRecord & { source_ids: string[] })[] {
  if (records.length === 0) return []

  // --- Phase 1: sequential merge (same as before) ---
  const phase1: MergeRecord[] = [{ ...records[0]!, source_ids: records[0]!.id ? [records[0]!.id] : [] }]

  for (let i = 1; i < records.length; i++) {
    const current = records[i]!
    const prev = phase1[phase1.length - 1]!

    const sameActivity = current.activity === prev.activity
    const sameMobile = (current.is_mobile ?? false) === (prev.is_mobile ?? false)
    const gap = current.start_time.getTime() - prev.end_time.getTime()
    const closeEnough = gap >= 0 && gap <= MERGE_GAP_MS

    if (sameActivity && sameMobile && closeEnough) {
      prev.end_time = current.end_time
      prev.duration_sec += current.duration_sec
      if (current.id) prev.source_ids.push(current.id)
    } else {
      phase1.push({ ...current, source_ids: current.id ? [current.id] : [] })
    }
  }

  // --- Phase 2: interleave merge ---
  // Walk forward; for each span check whether the most-recent span of the same
  // activity ended within MERGE_GAP_MS. If so, extend that earlier span and
  // drop the current one from the output.
  const phase2: MergeRecord[] = []
  // Maps "activity|is_mobile" -> index in phase2 of the last span for that key
  const lastIndexFor = new Map<string, number>()

  for (const span of phase1) {
    const key = `${span.activity}|${span.is_mobile ?? false}`
    const prevIdx = lastIndexFor.get(key)

    if (prevIdx !== undefined) {
      const prev = phase2[prevIdx]!
      const gap = span.start_time.getTime() - prev.end_time.getTime()

      if (gap >= 0 && gap <= MERGE_GAP_MS) {
        // Extend the earlier span; add this span's duration and source IDs
        prev.end_time = span.end_time
        prev.duration_sec += span.duration_sec
        prev.source_ids.push(...span.source_ids)
        // Update the index so future same-activity spans compare against the
        // latest end_time (which is now in the same slot prevIdx)
        lastIndexFor.set(key, prevIdx)
        continue
      }
    }

    // No mergeable predecessor — emit as a new span
    lastIndexFor.set(key, phase2.length)
    phase2.push({ ...span })
  }

  // Re-sort by start_time (interleave merging preserves the first-span position
  // but later spans may slot earlier ones after others are skipped)
  return phase2.sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
}

/** Internal type for category-merged spans. */
interface CategoryMergedSpan {
  start: Date
  end: Date
  groupKey: string
  records: MergeRecord[]
}

/**
 * Group key for category merging. Returns the full resolved_category path joined
 * by ' > ', or empty string for uncategorized records.
 */
export const categoryGroupKey = (r: ProductivityRecord): string =>
  r.resolved_category && r.resolved_category.length > 0 ? r.resolved_category.join(' > ') : ''

/**
 * Merge adjacent records sharing the same category group key within a gap tolerance.
 */
export const mergeAdjacentByCategory = (
  records: MergeRecord[],
  gapMs: number,
  groupKey: string,
): CategoryMergedSpan[] => {
  const spans: CategoryMergedSpan[] = []
  let open: CategoryMergedSpan | null = null

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
 * When spans from different subcategories of the same parent overlap within gapMs,
 * they merge into a single parent-level span (e.g. interleaved "Work > Programming"
 * and "Work > Communication" become "Work").
 */
export const promoteOverlappingSubcategories = (
  spans: CategoryMergedSpan[],
  gapMs: number,
): CategoryMergedSpan[] => {
  const byParent = new Map<string, CategoryMergedSpan[]>()
  const result: CategoryMergedSpan[] = []

  for (const span of spans) {
    const sepIdx = span.groupKey.indexOf(' > ')
    if (sepIdx === -1) {
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

    let currentStart = childSpans[0]!.start
    let currentEnd = childSpans[0]!.end
    let currentKey = childSpans[0]!.groupKey
    let currentRecords = [...childSpans[0]!.records]
    let multipleSubcats = false

    for (let i = 1; i < childSpans.length; i++) {
      const next = childSpans[i]!
      if (next.start.getTime() <= currentEnd.getTime() + gapMs) {
        if (next.groupKey !== currentKey) multipleSubcats = true
        if (next.end > currentEnd) currentEnd = next.end
        currentRecords.push(...next.records)
      } else {
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
 * Merge app-level records by resolved category and promote overlapping subcategories.
 * Returns one ProductivityResult per category span (with category_id),
 * plus a normalized categories map for the frontend to resolve IDs to metadata.
 * Excluded and uncategorized records are dropped.
 */
export function mergeByCategorySpans(
  records: MergeRecord[],
  gapMs: number,
  categories: ScreentimeCategory[],
): { results: ProductivityResult[]; categoriesMap: Record<string, CategoryInfo> } {
  const excludedPaths = new Set(
    categories.filter((c) => c.exclude_from_screentime).map((c) => c.name.join(' > ')),
  )

  // Build a lookup from category path -> category record (deepest match wins)
  const categoryByPath = new Map<string, ScreentimeCategory>()
  for (const cat of categories) {
    categoryByPath.set(cat.name.join(' > '), cat)
  }

  // Resolve a groupKey to the best matching category (walk from exact to parent)
  const resolveCategory = (groupKey: string): ScreentimeCategory | undefined => {
    const parts = groupKey.split(' > ')
    for (let depth = parts.length; depth > 0; depth--) {
      const path = parts.slice(0, depth).join(' > ')
      const cat = categoryByPath.get(path)
      if (cat) return cat
    }
    return undefined
  }

  // Filter out excluded and uncategorized records
  const categorized = records.filter((r) => {
    const key = categoryGroupKey(r)
    if (key === '') return false
    if (r.resolved_category) {
      for (let depth = r.resolved_category.length; depth > 0; depth--) {
        if (excludedPaths.has(r.resolved_category.slice(0, depth).join(' > '))) return false
      }
    }
    return true
  })

  // Group by category key and merge adjacent within gap
  const byKey = new Map<string, MergeRecord[]>()
  for (const record of categorized) {
    const key = categoryGroupKey(record)
    const list = byKey.get(key)
    if (list) list.push(record)
    else byKey.set(key, [record])
  }

  const categorySpans: CategoryMergedSpan[] = []
  for (const [key, recs] of byKey) {
    categorySpans.push(...mergeAdjacentByCategory(recs, gapMs, key))
  }

  // Promote overlapping subcategories to parent level
  const promoted = promoteOverlappingSubcategories(categorySpans, gapMs)

  // Build the normalized categories map and results
  const categoriesMap: Record<string, CategoryInfo> = {}

  const results = promoted.map((span) => {
    const allSourceIds = span.records.flatMap((r) =>
      r.source_ids.length > 0 ? r.source_ids : r.id ? [r.id] : [],
    )
    const totalDuration = span.records.reduce((sum, r) => sum + r.duration_sec, 0)
    const uniqueApps = [...new Set(span.records.map((r) => r.activity))]

    const cat = resolveCategory(span.groupKey)
    if (cat && !categoriesMap[cat.id]) {
      categoriesMap[cat.id] = { color: cat.color, name: cat.name, score: cat.score }
    }

    return {
      activity: uniqueApps.length === 1 ? uniqueApps[0]! : uniqueApps.join(', '),
      category_id: cat?.id,
      comments: [],
      duration_sec: totalDuration,
      end_time: span.end.toISOString(),
      resolved_category: span.groupKey.split(' > '),
      source_ids: allSourceIds.length > 1 ? allSourceIds : undefined,
      start_time: span.start.toISOString(),
    }
  })

  return { categoriesMap, results }
}

/**
 * Query productivity data for a time range.
 * Merges consecutive spans for the same activity to reduce visual clutter.
 * @param sync Optional sync provider to auto-refresh stale data before querying
 * @param mergeBy When 'category', merges by resolved_category with overlap promotion
 * @param mergeGapMs Gap tolerance for category merging (default 2 min)
 */
export async function queryProductivity(
  user: string,
  start: Date,
  end: Date,
  sync?: SyncProvider,
  mergeBy?: 'category',
  mergeGapMs?: number,
): Promise<{ data: ProductivityResult[]; categories?: Record<string, CategoryInfo> }> {
  // Fire-and-forget: trigger background sync so data is fresh for the next request
  if (sync) {
    void sync.syncRescueTimeIfNeeded(user)
  }

  const productivity = await getProductivity(user, start, end)
  const merged = mergeProductivitySpans(productivity)

  // When merge_by=category, do category-level merge + overlap promotion on the server
  if (mergeBy === 'category') {
    const categories = await getScreentimeCategories(user)
    const { categoriesMap, results } = mergeByCategorySpans(merged, mergeGapMs ?? MERGE_GAP_MS, categories)
    return { categories: categoriesMap, data: results }
  }

  // Default: return app-level merged records
  const allIds = merged.flatMap((p) => (p.source_ids.length > 0 ? p.source_ids : p.id ? [p.id] : []))
  const commentsMap = await getCommentsMap(user, 'productivity', allIds)
  return {
    data: merged.map((p) => {
      const comments = p.source_ids.flatMap((sid) => commentsMap.get(sid) ?? [])
      return {
        activity: p.activity,
        category: p.category,
        comments,
        duration_sec: p.duration_sec,
        end_time: p.end_time.toISOString(),
        id: p.id,
        is_mobile: p.is_mobile,
        productivity: p.productivity,
        resolved_category: p.resolved_category,
        source: p.source,
        source_ids: p.source_ids.length > 1 ? p.source_ids : undefined,
        start_time: p.start_time.toISOString(),
        title: p.title,
      }
    }),
  }
}

/**
 * Assemble raw bucketed productivity rows into screentime buckets with category breakdown.
 */
export const assembleScreentimeBuckets = (
  rows: Array<{
    bucket_start: Date
    resolved_category: string[] | null
    total_sec: number
  }>,
  bucketMs: number,
): Array<{
  start: string
  end: string
  total_sec: number
  categories: Array<{ path: string[]; total_sec: number }>
}> => {
  const bucketMap = new Map<
    string,
    { start: Date; categories: Array<{ path: string[]; total_sec: number }>; total_sec: number }
  >()

  for (const row of rows) {
    const key = row.bucket_start.toISOString()
    let entry = bucketMap.get(key)
    if (!entry) {
      entry = { categories: [], start: row.bucket_start, total_sec: 0 }
      bucketMap.set(key, entry)
    }
    entry.total_sec += row.total_sec
    entry.categories.push({
      path: row.resolved_category ?? [],
      total_sec: row.total_sec,
    })
  }

  return [...bucketMap.values()]
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((b) => ({
      categories: b.categories.sort((a, c) => c.total_sec - a.total_sec),
      end: new Date(b.start.getTime() + bucketMs).toISOString(),
      start: b.start.toISOString(),
      total_sec: b.total_sec,
    }))
}
