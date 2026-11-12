/**
 * Meals logged while `meal_food_items` did not record the item's name and icon have NULL
 * fallback labels, so they render blank once the id stops resolving (a restore on a server
 * whose library lacks the item). This one-shot, per-user backfill fills them from the live
 * resolver. Completion is recorded via `sync_state` (provider='aurboda',
 * data_type='meal_food_item_name_backfill'), so ids that resolve nowhere cost nothing later.
 */

import { query } from '../db/connection.ts'
import { getSyncState, upsertSyncState } from '../db/index.ts'
import { type CentralDb, getCentralDb } from './central-db.ts'
import { resolveFoodItemDisplay } from './food-items.ts'

const DATA_TYPE = 'meal_food_item_name_backfill'
const BATCH = 500

export const backfillMealFoodItemNames = async (
  user: string,
  { centralDb }: { centralDb?: Pick<CentralDb, 'getSharedFoodItemsByIds'> } = {},
): Promise<{ updated: number; skipped: boolean }> => {
  const state = await getSyncState(user, 'aurboda', DATA_TYPE)
  if (state?.status === 'idle' && state.last_sync_time) return { skipped: true, updated: 0 }

  const central = centralDb ?? getCentralDb()
  let after = '00000000-0000-0000-0000-000000000000'
  let updated = 0
  for (;;) {
    const ids = (
      await query<{ id: string }>(
        user,
        `SELECT DISTINCT food_item_id::text AS id FROM meal_food_items
          WHERE food_item_name IS NULL AND food_item_id > $1::uuid
          ORDER BY 1 LIMIT $2`,
        [after, BATCH],
      )
    ).rows.map((row) => row.id)
    if (ids.length === 0) break

    const resolved = [...(await resolveFoodItemDisplay(user, central, ids))]
    if (resolved.length > 0) {
      const result = await query(
        user,
        `UPDATE meal_food_items m
            SET food_item_name = v.name, food_item_icon = COALESCE(m.food_item_icon, v.icon)
           FROM unnest($1::uuid[], $2::text[], $3::text[]) AS v(id, name, icon)
          WHERE m.food_item_id = v.id AND m.food_item_name IS NULL`,
        [
          resolved.map(([id]) => id),
          resolved.map(([, display]) => display.name),
          resolved.map(([, display]) => display.icon ?? null),
        ],
      )
      updated += result.rowCount ?? 0
    }
    after = ids[ids.length - 1]
  }

  await upsertSyncState(user, {
    data_type: DATA_TYPE,
    last_sync_time: new Date(),
    provider: 'aurboda',
    status: 'idle',
  })
  return { skipped: false, updated }
}
