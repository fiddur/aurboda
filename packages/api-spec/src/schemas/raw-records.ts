/**
 * Raw records query schemas.
 *
 * raw_records is the per-user dump of everything incoming sync integrations
 * fetched, stored verbatim. Useful for debugging "the sync ran clean but no
 * activity/metric landed" — you can inspect what the upstream API actually
 * returned.
 */

import { z } from 'zod'

import {
  baseResponseSchema,
  endDateTimeQuerySchema,
  iso8601DateTimeSchema,
  startDateTimeQuerySchema,
} from './common.ts'

export const rawRecordSchema = z
  .object({
    id: z.string().uuid().meta({ description: 'Raw record ID' }),
    source: z.string().meta({ description: 'Data source (e.g. "garmin", "oura")' }),
    record_type: z.string().meta({ description: 'Record type within the source (e.g. "garmin_sleep")' }),
    external_id: z
      .string()
      .nullable()
      .meta({ description: 'Upstream ID used for conflict resolution, if any' }),
    recorded_at: iso8601DateTimeSchema.meta({ description: 'When the event occurred upstream' }),
    received_at: iso8601DateTimeSchema.meta({ description: 'When aurboda stored this record' }),
    data_keys: z.array(z.string()).meta({ description: 'Top-level keys of the stored JSON payload' }),
    data: z
      .unknown()
      .optional()
      .meta({ description: 'Full JSON payload — only populated when include_data=true' }),
  })
  .meta({ id: 'RawRecord' })

export type RawRecord = z.infer<typeof rawRecordSchema>

export const queryRawRecordsQuerySchema = z
  .object({
    source: z.string().optional().meta({ description: 'Filter by source (exact match)' }),
    record_type: z.string().optional().meta({ description: 'Filter by record_type (exact match)' }),
    external_id: z.string().optional().meta({ description: 'Filter by external_id (exact match)' }),
    start: startDateTimeQuerySchema.optional().meta({ description: 'Earliest recorded_at (inclusive)' }),
    end: endDateTimeQuerySchema.optional().meta({ description: 'Latest recorded_at (exclusive)' }),
    include_data: z.coerce.boolean().optional().meta({
      description:
        'Include the full JSON data payload. Default false — only top-level keys are returned, to keep responses small.',
    }),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(500)
      .optional()
      .meta({ description: 'Max entries to return (default 50)' }),
    offset: z.coerce.number().int().min(0).optional().meta({ description: 'Number of entries to skip' }),
  })
  .meta({ id: 'QueryRawRecordsQuery' })

export type QueryRawRecordsQuery = z.infer<typeof queryRawRecordsQuerySchema>

export const queryRawRecordsResponseSchema = baseResponseSchema
  .extend({
    data: z.array(rawRecordSchema).meta({ description: 'Matching raw records (newest first)' }),
    total: z.number().int().meta({ description: 'Total matching records' }),
  })
  .meta({ id: 'QueryRawRecordsResponse' })

export type QueryRawRecordsResponse = z.infer<typeof queryRawRecordsResponseSchema>
