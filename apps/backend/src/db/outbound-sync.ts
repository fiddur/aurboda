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
 * For update/delete operations on the same entity, supersedes any existing
 * pending entries to avoid redundant syncs.
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
export const getPendingOutboundSync = async (user: string, limit = 100): Promise<OutboundSyncEntry[]> => {
  // Auto-expire entries older than 90 days — HC won't accept them anyway
  await query(
    user,
    `UPDATE outbound_sync_queue
     SET status = 'failed'
     WHERE status = 'pending' AND created_at < NOW() - INTERVAL '90 days'`,
    [],
  )

  const result = await query(
    user,
    `SELECT id, entity_type, entity_id, operation, hc_record_type, payload,
            hc_record_id, status, created_at, synced_at
     FROM outbound_sync_queue
     WHERE status = 'pending'
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  )

  return result.rows.map(mapOutboundSyncRow)
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
// Row Mapper
// ============================================================================

const mapOutboundSyncRow = (row: Record<string, unknown>): OutboundSyncEntry => ({
  created_at: new Date(row.created_at as string),
  entity_id: row.entity_id as string,
  entity_type: row.entity_type as string,
  hc_record_id: (row.hc_record_id as string) ?? undefined,
  hc_record_type: row.hc_record_type as string,
  id: row.id as string,
  operation: row.operation as OutboundSyncOperation,
  payload: row.payload as Record<string, unknown>,
  status: row.status as OutboundSyncStatus,
  synced_at: row.synced_at ? new Date(row.synced_at as string) : undefined,
})
