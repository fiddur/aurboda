/**
 * Import jobs routes — start, list, and poll bulk imports of external food
 * databases (Livsmedelsverket, etc.).
 */

import {
  type ImportJob,
  type ImportJobResponse,
  type ImportJobsQuery,
  type ImportJobsResponse,
  importJobsQuerySchema,
} from '@aurboda/api-spec'

import type { ImportJobEntity } from '../db/types.ts'

import { getImportJobById, listImportJobs, reapStaleImportJobs } from '../db/index.ts'
import { startImport } from '../services/imports/runner.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

const serialize = (job: ImportJobEntity): ImportJob => ({
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

// Rate-limit the heartbeat reaper to at most once per minute per user. The
// list endpoint is polled every 2 s while an import runs, and we don't want
// an UPDATE per poll. Cleared per-user so unrelated users don't share state.
const REAP_INTERVAL_MS = 60_000
const lastReapAt: Map<string, number> = new Map()

const maybeReap = async (user: string): Promise<void> => {
  const now = Date.now()
  const last = lastReapAt.get(user) ?? 0
  if (now - last < REAP_INTERVAL_MS) return
  lastReapAt.set(user, now)
  try {
    const reaped = await reapStaleImportJobs(user)
    if (reaped > 0) console.info(`[imports] reaped ${reaped} stale jobs for ${user}`)
  } catch (err) {
    console.warn('[imports] reaper failed:', err instanceof Error ? err.message : err)
  }
}

export const createImportsRouter = (authMiddleware: AnyMiddleware): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, ImportJobsResponse, unknown, ImportJobsQuery>(
    '/',
    authMiddleware,
    validateQuery(importJobsQuerySchema),
    async (req, res) => {
      await maybeReap(req.user!)
      const jobs = await listImportJobs(req.user!, req.query.source, req.query.limit ?? 10)
      res.json({ data: jobs.map(serialize), success: true })
    },
  )

  router.get<{ id: string }, ImportJobResponse>('/:id', authMiddleware, async (req, res) => {
    const job = await getImportJobById(req.user!, req.params.id)
    if (!job) return res.status(404).json({ error: 'Import job not found', success: false })
    res.json({ data: serialize(job), success: true })
  })

  router.post<Record<string, never>, ImportJobResponse>(
    '/livsmedelsverket',
    authMiddleware,
    async (req, res) => {
      const job = await startImport(req.user!, 'livsmedelsverket', req.user)
      res.json({ data: serialize(job), success: true })
    },
  )

  return router
}
