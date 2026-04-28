/**
 * Fire-and-forget runner for bulk imports.
 *
 * Caller invokes `startImport()`, gets back the pending job record, and the
 * actual fetch/upsert work runs in the background. The UI polls `import_jobs`
 * for progress.
 *
 * If the backend crashes mid-run, `reapStaleImportJobs` (called from startup)
 * marks orphaned `running` jobs as `failed`.
 */

import type { ImportJobEntity } from '../../db/types.ts'

import {
  completeImportJob,
  failImportJob,
  insertImportJob,
  startImportJob,
  updateImportJobProgress,
} from '../../db/import-jobs.ts'
import { runLivsmedelsverketImport } from './livsmedelsverket.ts'

export type ImportSource = 'livsmedelsverket'

const runners: Record<ImportSource, (user: string, jobId: string) => Promise<void>> = {
  livsmedelsverket: async (user, jobId) => {
    let totalSet = false
    await runLivsmedelsverketImport(user, {
      onProgress: async (processed, total) => {
        if (!totalSet) {
          await startImportJob(user, jobId, total)
          totalSet = true
        }
        await updateImportJobProgress(user, jobId, processed)
      },
    })
  },
}

export const startImport = async (
  user: string,
  source: ImportSource,
  startedBy?: string,
): Promise<ImportJobEntity> => {
  const job = await insertImportJob(user, source, startedBy)
  // Run in background — caller does not await. Errors are persisted to the job.
  void (async () => {
    try {
      await runners[source](user, job.id)
      await completeImportJob(user, job.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[import] ${source} job ${job.id} failed:`, err)
      await failImportJob(user, job.id, message).catch((failErr) => {
        console.error(`[import] could not record failure for ${job.id}:`, failErr)
      })
    }
  })()
  return job
}
