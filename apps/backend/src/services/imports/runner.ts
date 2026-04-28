/**
 * Fire-and-forget runner for bulk imports into the central shared library.
 *
 * `startImport()` is single-flight: if a pending or running job already
 * exists for the same source it returns that job rather than launching a
 * second background promise. The runner persists progress to the central
 * `import_jobs` table; the UI polls those rows.
 *
 * If the backend crashes or stalls mid-run, the heartbeat-based reaper
 * (see `reapStaleImportJobs`) marks the job as failed.
 */

import type { CentralDb } from '../central-db.ts'
import type { CentralImportJobEntity } from '../central-import-jobs.ts'

import { runLivsmedelsverketImport } from './livsmedelsverket.ts'

export type ImportSource = 'livsmedelsverket'

const runners: Record<ImportSource, (centralDb: CentralDb, jobId: string) => Promise<void>> = {
  livsmedelsverket: async (centralDb, jobId) => {
    let totalSet = false
    await runLivsmedelsverketImport(centralDb, {
      onProgress: async (processed, skipped, total) => {
        if (!totalSet) {
          await centralDb.startImportJob(jobId, total)
          totalSet = true
        }
        await centralDb.updateImportJobProgress(jobId, processed, skipped)
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
  centralDb: CentralDb,
  source: ImportSource,
  startedBy?: string,
): Promise<CentralImportJobEntity> => {
  // Single-flight: if a job is already pending/running for this source,
  // return it instead of starting a parallel one. Two browser tabs or two
  // simultaneous MCP clients otherwise spawn duplicate runs and double the
  // upstream traffic.
  const active = await centralDb.getActiveImportJob(source)
  if (active) return active

  const job = await centralDb.insertImportJob(source, startedBy)
  // Run in background — caller does not await. Errors are persisted to the job.
  void (async () => {
    try {
      await runners[source](centralDb, job.id)
      await centralDb.completeImportJob(job.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[import] ${source} job ${job.id} failed:`, err)
      await centralDb.failImportJob(job.id, message).catch((failErr) => {
        console.error(`[import] could not record failure for ${job.id}:`, failErr)
      })
    }
  })()
  return job
}
