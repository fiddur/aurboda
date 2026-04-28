/**
 * Fire-and-forget runner for bulk imports.
 *
 * `startImport()` is single-flight: if a pending or running job already
 * exists for the same source it returns that job rather than launching a
 * second background promise. UI polls `import_jobs` for progress.
 *
 * If the backend crashes or stalls mid-run, the heartbeat-based reaper
 * (see `reapStaleImportJobs`) marks the job as failed.
 */

import type { ImportJobEntity } from '../../db/types.ts'

import {
  completeImportJob,
  failImportJob,
  getActiveImportJob,
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
      onProgress: async (processed, skipped, total) => {
        if (!totalSet) {
          await startImportJob(user, jobId, total)
          totalSet = true
        }
        await updateImportJobProgress(user, jobId, processed, skipped)
      },
    })
  },
}

/**
 * Indirection so tests can stub the per-source runner without HTTP.
 * @internal
 */
export const _setRunnerForTests = (source: ImportSource, fn: (typeof runners)[ImportSource]): void => {
  runners[source] = fn
}

export const startImport = async (
  user: string,
  source: ImportSource,
  startedBy?: string,
): Promise<ImportJobEntity> => {
  // Single-flight: if a job is already pending/running for this source,
  // return it instead of starting a parallel one. Two browser tabs or two
  // simultaneous MCP clients otherwise spawn duplicate runs and double the
  // upstream traffic.
  const active = await getActiveImportJob(user, source)
  if (active) return active

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
