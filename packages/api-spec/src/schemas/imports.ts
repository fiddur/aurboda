/**
 * Schemas for bulk imports of external food/nutrition databases.
 *
 * `import_jobs` tracks long-running fetch+upsert operations so the UI can
 * poll progress without us building a full job queue.
 */

import { z } from 'zod'

import { baseResponseSchema, iso8601DateTimeSchema } from './common.ts'

export const importSourceSchema = z.enum(['livsmedelsverket']).meta({
  description: 'External food/nutrition data source for bulk import',
  id: 'ImportSource',
})

export type ImportSource = z.infer<typeof importSourceSchema>

export const importStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']).meta({
  description: 'State of an import job',
  id: 'ImportStatus',
})

export type ImportStatus = z.infer<typeof importStatusSchema>

export const importJobSchema = z
  .object({
    completed_at: iso8601DateTimeSchema.optional().meta({ description: 'When the job finished' }),
    error: z.string().optional().meta({ description: 'Failure reason if status is "failed"' }),
    id: z.string().uuid().meta({ description: 'Job ID' }),
    last_progress_at: iso8601DateTimeSchema.meta({
      description: 'When processed_items was last updated; the reaper uses this for liveness',
    }),
    processed_items: z.number().int().meta({ description: 'How many items have been imported so far' }),
    skipped_items: z.number().int().meta({
      description: 'How many items the runner could not import (logged + skipped, not retried)',
    }),
    source: importSourceSchema,
    started_at: iso8601DateTimeSchema.meta({ description: 'When the job was started' }),
    started_by: z.string().optional().meta({ description: 'User who initiated the job' }),
    status: importStatusSchema,
    total_items: z.number().int().optional().meta({
      description: 'Total items the job will process (set after the catalog is fetched)',
    }),
  })
  .meta({ description: 'Bulk-import job record', id: 'ImportJob' })

export type ImportJob = z.infer<typeof importJobSchema>

export const importJobsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .meta({ description: 'Max number of jobs to return (default 10, max 100)' }),
    source: importSourceSchema.optional(),
  })
  .meta({ id: 'ImportJobsQuery' })

export type ImportJobsQuery = z.infer<typeof importJobsQuerySchema>

export const importJobsResponseSchema = baseResponseSchema
  .extend({
    data: z.array(importJobSchema).optional(),
  })
  .meta({ id: 'ImportJobsResponse' })

export type ImportJobsResponse = z.infer<typeof importJobsResponseSchema>

export const importJobResponseSchema = baseResponseSchema
  .extend({
    data: importJobSchema.optional(),
  })
  .meta({ id: 'ImportJobResponse' })

export type ImportJobResponse = z.infer<typeof importJobResponseSchema>
