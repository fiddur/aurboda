/**
 * Sync state tracking for external data providers.
 */
import { query } from './connection'
import { mapSyncStateRow } from './row-mappers'
import type { SyncState } from './types'

export const getSyncState = async (
  user: string,
  provider: string,
  dataType: string,
): Promise<SyncState | null> => {
  const result = await query(
    user,
    `SELECT id, provider, data_type, last_sync_time, sync_start_date, status, error_message, retry_after, updated_at
     FROM sync_state
     WHERE provider = $1 AND data_type = $2`,
    [provider, dataType],
  )

  if (result.rows.length === 0) return null

  return mapSyncStateRow(result.rows[0])
}

export const upsertSyncState = async (user: string, state: SyncState) => {
  await query(
    user,
    `INSERT INTO sync_state (provider, data_type, last_sync_time, sync_start_date, status, error_message, retry_after, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (provider, data_type) DO UPDATE SET
       last_sync_time = COALESCE(EXCLUDED.last_sync_time, sync_state.last_sync_time),
       sync_start_date = COALESCE(EXCLUDED.sync_start_date, sync_state.sync_start_date),
       status = EXCLUDED.status,
       error_message = EXCLUDED.error_message,
       retry_after = EXCLUDED.retry_after,
       updated_at = NOW()`,
    [
      state.provider,
      state.dataType,
      state.lastSyncTime,
      state.syncStartDate,
      state.status,
      state.errorMessage,
      state.retryAfter,
    ],
  )
}

export const getAllSyncStates = async (user: string, provider: string): Promise<SyncState[]> => {
  const result = await query(
    user,
    `SELECT id, provider, data_type, last_sync_time, sync_start_date, status, error_message, retry_after, updated_at
     FROM sync_state
     WHERE provider = $1
     ORDER BY data_type`,
    [provider],
  )

  return result.rows.map(mapSyncStateRow)
}

export const resetSyncState = async (user: string, provider: string, dataType?: string) => {
  if (dataType) {
    await query(user, `DELETE FROM sync_state WHERE provider = $1 AND data_type = $2`, [provider, dataType])
  } else {
    await query(user, `DELETE FROM sync_state WHERE provider = $1`, [provider])
  }
}
