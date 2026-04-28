/**
 * Admin-only routes for bulk imports of external food databases (Livsmedelsverket
 * today, possibly USDA/OpenFoodFacts later). Imports target the central
 * shared library, so the routes live under /admin/imports.
 */

import {
  type ImportJob,
  type ImportJobResponse,
  type ImportJobsQuery,
  type ImportJobsResponse,
  importJobsQuerySchema,
} from '@aurboda/api-spec'

import type { CentralDb } from '../services/central-db.ts'
import type { CentralImportJobEntity } from '../services/central-import-jobs.ts'

import { startImport } from '../services/imports/runner.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

const serialize = (job: CentralImportJobEntity): ImportJob => ({
  completed_at: job.completed_at?.toISOString(),
  error: job.error,
  id: job.id,
  last_progress_at: job.last_progress_at.toISOString(),
  processed_items: job.processed_items,
  skipped_items: job.skipped_items,
  source: job.source as ImportJob['source'],
  started_at: job.started_at.toISOString(),
  started_by: job.started_by,
  status: job.status,
  total_items: job.total_items,
})

// Run the heartbeat reaper at most once a minute. The list endpoint is
// polled every 2s while the admin page is open, so without this guard we'd
// fire an UPDATE per poll while idle.
const REAP_INTERVAL_MS = 60_000
let lastReapAt = 0

const maybeReap = async (centralDb: CentralDb): Promise<void> => {
  const now = Date.now()
  if (now - lastReapAt < REAP_INTERVAL_MS) return
  lastReapAt = now
  try {
    const reaped = await centralDb.reapStaleImportJobs()
    if (reaped > 0) console.info(`[imports] reaped ${reaped} stale jobs`)
  } catch (err) {
    console.warn('[imports] reaper failed:', err instanceof Error ? err.message : err)
  }
}

export const createImportsRouter = (
  authMiddleware: AnyMiddleware,
  adminMiddleware: AnyMiddleware,
  centralDb: CentralDb,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, ImportJobsResponse, unknown, ImportJobsQuery>(
    '/',
    authMiddleware,
    adminMiddleware,
    validateQuery(importJobsQuerySchema),
    async (req, res) => {
      await maybeReap(centralDb)
      const jobs = await centralDb.listImportJobs(req.query.source, req.query.limit ?? 10)
      res.json({ data: jobs.map(serialize), success: true })
    },
  )

  router.get<{ id: string }, ImportJobResponse>('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    const job = await centralDb.getImportJobById(req.params.id)
    if (!job) return res.status(404).json({ error: 'Import job not found', success: false })
    res.json({ data: serialize(job), success: true })
  })

  router.post<Record<string, never>, ImportJobResponse>(
    '/livsmedelsverket',
    authMiddleware,
    adminMiddleware,
    async (req, res) => {
      const job = await startImport(centralDb, 'livsmedelsverket', req.user)
      res.json({ data: serialize(job), success: true })
    },
  )

  return router
}
