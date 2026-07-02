/**
 * Outbound sync queue operations.
 *
 * Manages the queue of changes that need to be pushed to Health Connect
 * from the Android app.
 */
import { query } from './connection.ts'

// ============================================================================
// Types
// ============================================================================

export type OutboundSyncOperation = 'insert' | 'update' | 'delete'
export type OutboundSyncStatus = 'pending' | 'synced' | 'failed'

export interface OutboundSyncEntry {
  id: string
  entity_type: string
  entity_id: string
  operation: OutboundSyncOperation
  hc_record_type: string
  payload: Record<string, unknown>
  hc_record_id?: string
  status: OutboundSyncStatus
  fail_count: number
  fail_reason?: string
  created_at: Date
  synced_at?: Date
}

export interface EnqueueOutboundSyncInput {
  entity_type: string
  entity_id: string
  operation: OutboundSyncOperation
  hc_record_type: string
  payload: Record<string, unknown>
}

// ============================================================================
// Queue Operations
// ============================================================================

/**
 * Add an entry to the outbound sync queue.
 *
 * Dedup behaviour by `(entity_type, entity_id)`:
 * - `update` / `delete`: supersede (mark synced) any prior pending entries,
 *   then enqueue this one.
 * - `insert`: if a pending insert already exists for the same entity,
 *   update its payload in place and return the existing id. Avoids the
 *   duplicate-flood that otherwise occurs when the same per-minute entity
 *   (e.g. `calories_active|<ts>`) is re-enqueued on every recompute.
 *
 * Note: the insert dedup is UPDATE…RETURNING followed by a conditional
 * INSERT, which is not strictly atomic — two concurrent inserts for the
 * same entity could both see no existing row and both INSERT. The calorie
 * worker serialises per-user runs so this is unlikely in practice; if a
 * hard guarantee is needed later, add a partial unique index on
 * `(entity_type, entity_id) WHERE status = 'pending' AND operation = 'insert'`
 * and switch the INSERT to `ON CONFLICT … DO UPDATE`.
 */
export const enqueueOutboundSync = async (user: string, input: EnqueueOutboundSyncInput): Promise<string> => {
  // For update/delete: supersede any pending entries for the same entity
  if (input.operation === 'update' || input.operation === 'delete') {
    await query(
      user,
      `UPDATE outbound_sync_queue
       SET status = 'synced', synced_at = NOW()
       WHERE entity_type = $1 AND entity_id = $2 AND status = 'pending'`,
      [input.entity_type, input.entity_id],
    )
  }

  // For insert: if a pending insert for the same entity already exists,
  // update its payload (latest value wins) and return the existing id.
  if (input.operation === 'insert') {
    const existing = await query(
      user,
      `UPDATE outbound_sync_queue
       SET payload = $1, hc_record_type = $2
       WHERE entity_type = $3 AND entity_id = $4 AND status = 'pending' AND operation = 'insert'
       RETURNING id`,
      [input.payload, input.hc_record_type, input.entity_type, input.entity_id],
    )
    if (existing.rowCount && existing.rowCount > 0) {
      return existing.rows[0].id as string
    }
  }

  const result = await query(
    user,
    `INSERT INTO outbound_sync_queue (entity_type, entity_id, operation, hc_record_type, payload)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [input.entity_type, input.entity_id, input.operation, input.hc_record_type, input.payload],
  )

  return result.rows[0].id as string
}

/**
 * Get pending outbound sync entries.
 *
 * Ordered newest-first so recent user actions (exercises, weight entries) are
 * synced immediately instead of being starved by bulk historical data.
 *
 * Entries older than 90 days are auto-expired (marked 'failed') since Health
 * Connect typically ignores data that old.
 */
export interface PendingOutboundSyncResult {
  entries: OutboundSyncEntry[]
  total_pending: number
}

export const getPendingOutboundSync = async (
  user: string,
  limit = 100,
): Promise<PendingOutboundSyncResult> => {
  // Auto-expire entries older than 90 days — HC won't accept them anyway
  await query(
    user,
    `UPDATE outbound_sync_queue
     SET status = 'failed'
     WHERE status = 'pending' AND created_at < NOW() - INTERVAL '90 days'`,
    [],
  )

  // Get total pending count and entries in a single round-trip
  const countResult = await query(
    user,
    `SELECT COUNT(*)::int AS total FROM outbound_sync_queue WHERE status = 'pending'`,
    [],
  )
  const total_pending = (countResult.rows[0]?.total as number) ?? 0

  const result = await query(
    user,
    `SELECT id, entity_type, entity_id, operation, hc_record_type, payload,
            hc_record_id, status, fail_count, fail_reason, created_at, synced_at
     FROM outbound_sync_queue
     WHERE status = 'pending'
     ORDER BY
       CASE WHEN entity_type = 'activity' THEN 0 ELSE 1 END,
       created_at DESC
     LIMIT $1`,
    [limit],
  )

  return {
    entries: result.rows.map(mapOutboundSyncRow),
    total_pending,
  }
}

/**
 * Acknowledge that an outbound sync entry was successfully written to Health Connect.
 * Updates the status and stores the HC-assigned record ID.
 */
export const ackOutboundSync = async (user: string, id: string, hcRecordId?: string): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE outbound_sync_queue
     SET status = 'synced', synced_at = NOW(), hc_record_id = COALESCE($2, hc_record_id)
     WHERE id = $1 AND status = 'pending'`,
    [id, hcRecordId ?? null],
  )

  return (result.rowCount ?? 0) > 0
}

/**
 * Mark an outbound sync entry as failed.
 */
export const failOutboundSync = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE outbound_sync_queue
     SET status = 'failed'
     WHERE id = $1 AND status = 'pending'`,
    [id],
  )

  return (result.rowCount ?? 0) > 0
}

/**
 * Find the HC record ID for an entity that was previously synced to Health Connect.
 * Used when deleting/updating an entity that may have a corresponding HC record.
 */
export const findHcRecordId = async (
  user: string,
  entityType: string,
  entityId: string,
): Promise<string | undefined> => {
  const result = await query(
    user,
    `SELECT hc_record_id FROM outbound_sync_queue
     WHERE entity_type = $1 AND entity_id = $2 AND hc_record_id IS NOT NULL
     ORDER BY synced_at DESC
     LIMIT 1`,
    [entityType, entityId],
  )

  return result.rows[0]?.hc_record_id as string | undefined
}

// ============================================================================
// Failure Reporting & Retry
// ============================================================================

const MAX_RETRIES = 5

/**
 * Report a sync failure for an outbound sync entry.
 *
 * Increments fail_count and stores the failure reason. If fail_count reaches
 * MAX_RETRIES, marks the entry as 'failed'. Otherwise keeps it 'pending' for retry.
 */
export const reportSyncFailure = async (
  user: string,
  id: string,
  reason: string,
): Promise<{ retrying: boolean; fail_count: number }> => {
  const result = await query(
    user,
    `UPDATE outbound_sync_queue
     SET fail_count = fail_count + 1,
         fail_reason = $2,
         status = CASE WHEN fail_count + 1 >= $3 THEN 'failed' ELSE 'pending' END
     WHERE id = $1 AND status = 'pending'
     RETURNING fail_count`,
    [id, reason, MAX_RETRIES],
  )

  if (result.rows.length === 0) {
    return { fail_count: 0, retrying: false }
  }

  const fail_count = result.rows[0].fail_count as number
  return { fail_count, retrying: fail_count < MAX_RETRIES }
}

/**
 * Re-queue a failed or synced outbound sync entry for retry.
 *
 * Resets the entry back to 'pending' with fail_count = 0 and clears fail_reason.
 */
export const requeueOutboundSync = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE outbound_sync_queue
     SET status = 'pending', fail_count = 0, fail_reason = NULL, synced_at = NULL
     WHERE id = $1 AND status IN ('failed', 'synced')`,
    [id],
  )

  return (result.rowCount ?? 0) > 0
}

/**
 * Get outbound sync history including completed and failed entries.
 *
 * Returns ALL entries regardless of status, ordered by created_at DESC.
 */
export const getOutboundSyncHistory = async (user: string, limit = 50): Promise<OutboundSyncEntry[]> => {
  const result = await query(
    user,
    `SELECT id, entity_type, entity_id, operation, hc_record_type, payload,
            hc_record_id, status, fail_count, fail_reason, created_at, synced_at
     FROM outbound_sync_queue
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  )

  return result.rows.map(mapOutboundSyncRow)
}

// ============================================================================
// Row Mapper
// ============================================================================

const mapOutboundSyncRow = (row: Record<string, unknown>): OutboundSyncEntry => ({
  created_at: new Date(row.created_at as string),
  entity_id: row.entity_id as string,
  entity_type: row.entity_type as string,
  fail_count: (row.fail_count as number) ?? 0,
  fail_reason: (row.fail_reason as string) ?? undefined,
  hc_record_id: (row.hc_record_id as string) ?? undefined,
  hc_record_type: row.hc_record_type as string,
  id: row.id as string,
  operation: row.operation as OutboundSyncOperation,
  payload: row.payload as Record<string, unknown>,
  status: row.status as OutboundSyncStatus,
  synced_at: row.synced_at ? new Date(row.synced_at as string) : undefined,
})
