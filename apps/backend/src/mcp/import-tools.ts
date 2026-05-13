/**
 * MCP tools for triggering and inspecting bulk imports of the central
 * shared food library. Admin-only — non-admin callers see a permission
 * error.
 */

import { importJobsQuerySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import type { CentralDb } from '../services/central-db.ts'

import { startImport } from '../services/imports/runner.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerImportTools = (server: McpServer, user: string, centralDb: CentralDb) => {
  const requireAdmin = async (): Promise<string | null> => {
    const isAdmin = await centralDb.isAdmin(user)
    if (!isAdmin) return 'Admin permission required'
    return null
  }

  server.tool(
    'start_livsmedelsverket_import',
    'Start a bulk import of the Livsmedelsverket (Swedish Food Agency) food database into the central shared library. Admin-only. Runs in the background — poll get_import_job for progress.',
    {},
    async () => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      const job = await startImport(centralDb, 'livsmedelsverket', user)
      return jsonResponse({ data: job, success: true })
    },
  )

  server.tool(
    'list_import_jobs',
    'List recent bulk-import jobs, newest first. Admin-only.',
    { ...importJobsQuerySchema.shape },
    async (params) => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      const jobs = await centralDb.listImportJobs(params.source, params.limit ?? 10)
      return jsonResponse({ data: jobs, success: true })
    },
  )

  server.tool(
    'get_import_job',
    'Get a single import job by ID. Admin-only.',
    { id: z.string().uuid().describe('Import job ID') },
    async ({ id }) => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      const job = await centralDb.getImportJobById(id)
      if (!job) return errorResponse('Import job not found')
      return jsonResponse({ data: job, success: true })
    },
  )
}
