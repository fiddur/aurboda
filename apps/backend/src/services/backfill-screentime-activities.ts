/**
 * One-shot backfill: convert historical categorized productivity records
 * into `screentime` activities.
 *
 * Before this existed, the v1 of screentime-as-activities (#648) was
 * forward-looking only — new RescueTime / ActivityWatch syncs produced
 * activities, but a user's existing productivity history did not.
 * Migrating daily summary / chart data / deduction rules to read from
 * activities (#653) therefore requires a one-shot fill-in of the
 * historical gap.
 *
 * Completion is recorded via `sync_state` (provider='aurboda',
 * data_type='screentime_backfill'), so subsequent calls short-circuit.
 * Activity inserts are idempotent via the (source, external_id) unique
 * index — re-running after a crash is safe.
 */

import type { ProductivityRecord } from '../db/types.ts'

import { query } from '../db/connection.ts'
import { getScreentimeCategories, getSyncState, insertActivities, upsertSyncState } from '../db/index.ts'
import { buildScreentimeActivitySpans, spansToActivities } from './screentime-activities.ts'

export interface BackfillResult {
  /** How many screentime activities were upserted. */
  created: number
  /** True if the backfill short-circuited (already completed or nothing to do). */
  skipped: boolean
  reason?: 'already_completed' | 'no_categories' | 'no_records'
}

const BACKFILL_DATA_TYPE = 'screentime_backfill'

export const backfillScreentimeActivities = async (user: string): Promise<BackfillResult> => {
  const state = await getSyncState(user, 'aurboda', BACKFILL_DATA_TYPE)
  if (state?.status === 'idle' && state.last_sync_time) {
    return { created: 0, reason: 'already_completed', skipped: true }
  }

  const categories = await getScreentimeCategories(user)
  if (categories.length === 0) {
    await upsertSyncState(user, {
      data_type: BACKFILL_DATA_TYPE,
      last_sync_time: new Date(),
      provider: 'aurboda',
      status: 'idle',
    })
    return { created: 0, reason: 'no_categories', skipped: true }
  }

  // ORDER BY start_time is load-bearing: buildScreentimeActivitySpans walks
  // records sequentially and merges adjacent same-category ones within a gap,
  // so unordered input would produce fragmented / incorrectly-merged spans.
  const result = await query(
    user,
    `SELECT source, start_time, end_time, activity, title, duration_sec, resolved_category
       FROM productivity
      WHERE resolved_category IS NOT NULL
        AND deleted_at IS NULL
      ORDER BY start_time`,
  )
  const records: ProductivityRecord[] = result.rows.map((row) => ({
    activity: row.activity as string,
    duration_sec: row.duration_sec as number,
    end_time: new Date(row.end_time as string),
    resolved_category: row.resolved_category as string[],
    source: row.source as ProductivityRecord['source'],
    start_time: new Date(row.start_time as string),
    ...(row.title ? { title: row.title as string } : {}),
  }))

  if (records.length === 0) {
    await upsertSyncState(user, {
      data_type: BACKFILL_DATA_TYPE,
      last_sync_time: new Date(),
      provider: 'aurboda',
      status: 'idle',
    })
    return { created: 0, reason: 'no_records', skipped: true }
  }

  const spans = buildScreentimeActivitySpans(records, categories)
  const activities = spansToActivities(spans)
  if (activities.length > 0) {
    await insertActivities(user, activities)
  }

  await upsertSyncState(user, {
    data_type: BACKFILL_DATA_TYPE,
    last_sync_time: new Date(),
    provider: 'aurboda',
    status: 'idle',
  })

  return { created: activities.length, skipped: false }
}
