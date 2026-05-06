/**
 * Convert categorized productivity records into screentime activities.
 *
 * We mirror the frontend `productivityMerge.ts` contract: adjacent records of
 * the same resolved category within MERGE_GAP_MS collapse into a single span.
 * Each span becomes an activity whose `activity_type` is the category's
 * derived type slug (one type per category, mirroring the category hierarchy
 * via `parent_type`). Categories that haven't been linked yet — legacy data
 * before the link migration ran — fall back to the umbrella `screentime` type.
 *
 * Uncategorized records and records under categories flagged
 * exclude_from_screentime are skipped — they remain in the productivity table
 * but do not produce activities.
 */

import { isScreentimeActivity } from '@aurboda/api-spec'

import type { ProductivityRecord, ScreentimeCategory } from '../db/index.ts'
import type { Activity } from '../db/types.ts'

import { getScoreForCategory } from './screentime-categories.ts'

const MERGE_GAP_MS = 2 * 60 * 1000 // Mirrors productivityMerge.ts
const MIN_SPAN_MS = 60_000 // Skip spans shorter than 1 minute

export const categoryPathToString = (path: string[]): string => path.join(' > ')

export const categoryPathFromString = (s: string): string[] => s.split(' > ')

/**
 * Extract the parsed `category_path` array from a screentime activity, if it
 * carries one. Layered on the shared `isScreentimeActivity` type guard from
 * api-spec — the parsing (string → array) is the only piece this helper adds
 * on top of the guard.
 */
export const getScreentimeCategoryPath = (activity: Activity): string[] | undefined =>
  isScreentimeActivity(activity) ? categoryPathFromString(activity.data.category_path) : undefined

/** True if `categoryPath` is at or under one of the excluded paths (prefix match). */
export const isCategoryExcluded = (categoryPath: string[], excludedPaths: string[][]): boolean =>
  excludedPaths.some(
    (excluded) =>
      categoryPath.length >= excluded.length && excluded.every((seg, idx) => seg === categoryPath[idx]),
  )

/** Fallback activity type when a category isn't linked yet (pre-migration data). */
const UMBRELLA_TYPE = 'screentime'

interface Span {
  category_path: string[]
  /** Derived activity type slug for this span's category. Falls back to `screentime` for unlinked legacy categories. */
  activity_type: string
  source: string
  start_time: Date
  end_time: Date
  score?: number
}

/**
 * Group records by (source, resolved_category) and merge adjacent same-group
 * records within MERGE_GAP_MS. Records are grouped by source so rescuetime and
 * activitywatch spans for the same category don't conflate — they have
 * different source attribution and different authoritative views of the hour.
 */
export const buildScreentimeActivitySpans = (
  records: ProductivityRecord[],
  categories: ScreentimeCategory[],
): Span[] => {
  const excludedPaths = categories.filter((c) => c.exclude_from_screentime).map((c) => c.name)
  // Index categories by joined path for O(1) lookup inside the merge loop.
  const categoryByPath = new Map<string, ScreentimeCategory>()
  for (const c of categories) categoryByPath.set(categoryPathToString(c.name), c)

  const groups = new Map<string, ProductivityRecord[]>()
  for (const record of records) {
    const cat = record.resolved_category
    if (!cat || cat.length === 0) continue
    if (!record.source) continue
    if (isCategoryExcluded(cat, excludedPaths)) continue
    const key = `${record.source}:${categoryPathToString(cat)}`
    const bucket = groups.get(key) ?? []
    bucket.push(record)
    groups.set(key, bucket)
  }

  const spans: Span[] = []
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
    const first = sorted[0]
    const score = getScoreForCategory(first.resolved_category!, categories)
    const matchingCategory = categoryByPath.get(categoryPathToString(first.resolved_category!))
    const activityType = matchingCategory?.activity_type_name ?? UMBRELLA_TYPE
    const makeSpan = (r: ProductivityRecord): Span => ({
      activity_type: activityType,
      category_path: r.resolved_category!,
      end_time: r.end_time,
      source: r.source!,
      start_time: r.start_time,
      ...(score !== undefined ? { score } : {}),
    })

    let current = makeSpan(first)
    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i]
      const gap = next.start_time.getTime() - current.end_time.getTime()
      if (gap <= MERGE_GAP_MS) {
        if (next.end_time > current.end_time) current.end_time = next.end_time
      } else {
        spans.push(current)
        current = makeSpan(next)
      }
    }
    spans.push(current)
  }

  return spans
    .filter((s) => s.end_time.getTime() - s.start_time.getTime() >= MIN_SPAN_MS)
    .sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
}

/**
 * Convert spans to Activity records for bulk insert.
 *
 * external_id is deterministic: `${source}_${startEpoch}_${activity_type}`.
 * The activity_type slug replaced the joined category path in the v2 format
 * because slugs are stable across category renames (a renamed category keeps
 * its slug, so re-syncs upsert onto the same row). v1 activities written with
 * `${source}_${startEpoch}_${categoryPath}` and `activity_type='screentime'`
 * remain queryable but won't collide with v2 inserts — they sit in their own
 * keyspace until #652 backfills them under the new types.
 */
export const spansToActivities = (spans: Span[]): Activity[] =>
  spans.map((span) => {
    const categoryPath = categoryPathToString(span.category_path)
    return {
      activity_type: span.activity_type,
      data: {
        category_path: categoryPath,
        ...(span.score !== undefined ? { score: span.score } : {}),
      },
      end_time: span.end_time,
      external_id: `${span.source}_${span.start_time.getTime()}_${span.activity_type}`,
      source: span.source as Activity['source'],
      start_time: span.start_time,
    }
  })
