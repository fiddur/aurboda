/**
 * Import jobs routes — start, list, and poll bulk imports of external food
 * databases (Livsmedelsverket, etc.).
 */

import type { RequestHandler } from 'express'

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
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

const serialize = (job: ImportJobEntity): ImportJob => ({
  completed_at: job.completed_at?.toISOString(),
  error: job.error,
  id: job.id,
  processed_items: job.processed_items,
  source: job.source as ImportJob['source'],
  started_at: job.started_at.toISOString(),
  started_by: job.started_by,
  status: job.status,
  total_items: job.total_items,
})

export const createImportsRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, ImportJobsResponse, unknown, ImportJobsQuery>(
    '/',
    authMiddleware,
    validateQuery(importJobsQuerySchema),
    async (req, res) => {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10
      // Reap "running" jobs left behind by a backend crash so the UI doesn't
      // show a stuck progress bar. Cheap (single UPDATE), worth doing on the
      // poll path so the user sees fresh state without a server-startup hook.
      await reapStaleImportJobs(req.user!).catch(() => {})
      const jobs = await listImportJobs(req.user!, req.query.source, limit)
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
