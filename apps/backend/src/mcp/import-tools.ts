/**
 * MCP tools for triggering and inspecting bulk imports.
 */

import { importJobsQuerySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import { getImportJobById, listImportJobs } from '../db/index.ts'
import { startImport } from '../services/imports/runner.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerImportTools = (server: McpServer, user: string) => {
  server.tool(
    'start_livsmedelsverket_import',
    'Start a bulk import of the Livsmedelsverket (Swedish Food Agency) food database into the canonical food items library. Runs in the background — poll get_import_job for progress.',
    {},
    async () => {
      const job = await startImport(user, 'livsmedelsverket', user)
      return jsonResponse({ data: job, success: true })
    },
  )

  server.tool(
    'list_import_jobs',
    'List recent bulk-import jobs, newest first.',
    { ...importJobsQuerySchema.shape },
    async (params) => {
      const jobs = await listImportJobs(user, params.source, params.limit ?? 10)
      return jsonResponse({ data: jobs, success: true })
    },
  )

  server.tool(
    'get_import_job',
    'Get a single import job by ID.',
    { id: z.string().uuid().describe('Import job ID') },
    async ({ id }) => {
      const job = await getImportJobById(user, id)
      if (!job) return errorResponse('Import job not found')
      return jsonResponse({ data: job, success: true })
    },
  )
}
