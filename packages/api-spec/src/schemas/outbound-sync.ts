/**
 * Outbound sync schemas.
 *
 * Used by the Android app to fetch pending changes from the backend
 * and write them to Health Connect.
 */

import { z } from 'zod'

import { baseResponseSchema, iso8601DateTimeSchema } from './common.ts'

// ============================================================================
// Outbound Sync Entry
// ============================================================================

/**
 * Outbound sync operation type.
 */
export const outboundSyncOperationSchema = z.enum(['insert', 'update', 'delete']).meta({
  description: 'Type of operation to perform in Health Connect',
  id: 'OutboundSyncOperation',
})

export type OutboundSyncOperation = z.infer<typeof outboundSyncOperationSchema>

/**
 * Outbound sync entry status.
 */
export const outboundSyncStatusSchema = z.enum(['pending', 'synced', 'failed']).meta({
  description: 'Status of the outbound sync entry',
  id: 'OutboundSyncStatus',
})

export type OutboundSyncStatus = z.infer<typeof outboundSyncStatusSchema>

/**
 * A single outbound sync entry representing a change to push to Health Connect.
 */
export const outboundSyncEntrySchema = z
  .object({
    created_at: iso8601DateTimeSchema.meta({ description: 'When the change was queued' }),
    entity_id: z.string().meta({ description: 'ID of the entity that changed' }),
    entity_type: z.string().meta({ description: 'Type of entity (activity, time_series)' }),
    fail_count: z.number().int().meta({ description: 'Number of times sync has failed for this entry' }),
    fail_reason: z.string().optional().meta({ description: 'Reason for the most recent sync failure' }),
    hc_record_id: z.string().optional().meta({ description: 'Health Connect record ID (set after sync)' }),
    hc_record_type: z
      .string()
      .meta({ description: 'Health Connect record type to write (e.g., ExerciseSessionRecord)' }),
    id: z.string().uuid().meta({ description: 'Sync queue entry ID' }),
    operation: outboundSyncOperationSchema,
    payload: z.record(z.string(), z.unknown()).meta({
      description: 'Data to write to Health Connect',
    }),
    status: outboundSyncStatusSchema,
    synced_at: iso8601DateTimeSchema.optional().meta({ description: 'When the sync was completed' }),
  })
  .meta({ description: 'A pending change to push to Health Connect', id: 'OutboundSyncEntry' })

export type OutboundSyncEntry = z.infer<typeof outboundSyncEntrySchema>

// ============================================================================
// API Request/Response Schemas
// ============================================================================

/**
 * Response schema for GET /sync/outbound - pending changes.
 */
export const outboundSyncResponseSchema = baseResponseSchema
  .extend({
    data: z.array(outboundSyncEntrySchema).optional().meta({
      description: 'Pending outbound sync entries',
    }),
    total_pending: z.number().int().optional().meta({
      description: 'Total number of pending entries in the queue (for pagination)',
    }),
  })
  .meta({ id: 'OutboundSyncResponse' })

export type OutboundSyncResponse = z.infer<typeof outboundSyncResponseSchema>

/**
 * Single ack item for acknowledging a synced entry.
 */
export const outboundSyncAckItemSchema = z
  .object({
    hc_record_id: z
      .string()
      .optional()
      .meta({ description: 'Health Connect record ID assigned after writing' }),
    id: z.string().uuid().meta({ description: 'Sync queue entry ID to acknowledge' }),
  })
  .meta({ id: 'OutboundSyncAckItem' })

export type OutboundSyncAckItem = z.infer<typeof outboundSyncAckItemSchema>

/**
 * Request body for POST /sync/outbound/ack - acknowledge synced entries.
 */
export const outboundSyncAckBodySchema = z
  .object({
    entries: z.array(outboundSyncAckItemSchema).min(1).meta({
      description: 'List of sync entries to acknowledge',
    }),
  })
  .meta({ id: 'OutboundSyncAckBody' })

export type OutboundSyncAckBody = z.infer<typeof outboundSyncAckBodySchema>

/**
 * Response for POST /sync/outbound/ack.
 */
export const outboundSyncAckResponseSchema = baseResponseSchema
  .extend({
    acknowledged: z.number().int().optional().meta({
      description: 'Number of entries acknowledged',
    }),
  })
  .meta({ id: 'OutboundSyncAckResponse' })

export type OutboundSyncAckResponse = z.infer<typeof outboundSyncAckResponseSchema>

// ============================================================================
// Fail Reporting
// ============================================================================

/**
 * Single fail item for reporting a sync failure.
 */
export const outboundSyncFailItemSchema = z
  .object({
    id: z.string().uuid().meta({ description: 'Sync queue entry ID that failed' }),
    reason: z.string().meta({ description: 'Reason for the failure' }),
  })
  .meta({ id: 'OutboundSyncFailItem' })

export type OutboundSyncFailItem = z.infer<typeof outboundSyncFailItemSchema>

/**
 * Request body for POST /sync/outbound/fail - report sync failures.
 */
export const outboundSyncFailBodySchema = z
  .object({
    entries: z.array(outboundSyncFailItemSchema).min(1).meta({
      description: 'List of sync entries that failed',
    }),
  })
  .meta({ description: 'Report outbound sync failures from Health Connect', id: 'OutboundSyncFailBody' })

export type OutboundSyncFailBody = z.infer<typeof outboundSyncFailBodySchema>

/**
 * Response for POST /sync/outbound/fail.
 */
export const outboundSyncFailResponseSchema = baseResponseSchema
  .extend({
    reported: z.number().int().optional().meta({
      description: 'Number of failures reported',
    }),
  })
  .meta({ id: 'OutboundSyncFailResponse' })

export type OutboundSyncFailResponse = z.infer<typeof outboundSyncFailResponseSchema>

// ============================================================================
// Requeue
// ============================================================================

/**
 * Request body for POST /sync/outbound/requeue - re-queue a failed/synced entry.
 */
export const outboundSyncRequeueBodySchema = z
  .object({
    id: z.string().uuid().meta({ description: 'Sync queue entry ID to re-queue' }),
  })
  .meta({
    description: 'Re-queue a failed or synced outbound sync entry for retry',
    id: 'OutboundSyncRequeueBody',
  })

export type OutboundSyncRequeueBody = z.infer<typeof outboundSyncRequeueBodySchema>

/**
 * Response for POST /sync/outbound/requeue.
 */
export const outboundSyncRequeueResponseSchema = baseResponseSchema
  .extend({
    requeued: z.boolean().optional().meta({
      description: 'Whether the entry was successfully re-queued',
    }),
  })
  .meta({ id: 'OutboundSyncRequeueResponse' })

export type OutboundSyncRequeueResponse = z.infer<typeof outboundSyncRequeueResponseSchema>
