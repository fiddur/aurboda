/**
 * CRUD + state transitions for the import_jobs table.
 *
 * State diagram: pending → running → completed | failed.
 * The runner sets total_items once the catalog is fetched, then ticks
 * processed_items as it goes.
 */

import type { ImportJobEntity } from './types.ts'

import { query } from './connection.ts'

const COLUMNS =
  'id, source, status, started_at, completed_at, total_items, processed_items, error, started_by'

const mapRow = (row: Record<string, unknown>): ImportJobEntity => ({
  completed_at: row.completed_at ? new Date(row.completed_at as string) : undefined,
  error: (row.error as string | null) ?? undefined,
  id: row.id as string,
  processed_items: row.processed_items as number,
  source: row.source as string,
  started_at: new Date(row.started_at as string),
  started_by: (row.started_by as string | null) ?? undefined,
  status: row.status as ImportJobEntity['status'],
  total_items: (row.total_items as number | null) ?? undefined,
})

export const insertImportJob = async (
  user: string,
  source: string,
  startedBy?: string,
): Promise<ImportJobEntity> => {
  const result = await query(
    user,
    `INSERT INTO import_jobs (source, started_by) VALUES ($1, $2) RETURNING ${COLUMNS}`,
    [source, startedBy ?? null],
  )
  return mapRow(result.rows[0])
}

export const getImportJobById = async (user: string, id: string): Promise<ImportJobEntity | null> => {
  const result = await query(user, `SELECT ${COLUMNS} FROM import_jobs WHERE id = $1`, [id])
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null
}

export const listImportJobs = async (
  user: string,
  source?: string,
  limit = 10,
): Promise<ImportJobEntity[]> => {
  const result = source
    ? await query(
        user,
        `SELECT ${COLUMNS} FROM import_jobs WHERE source = $1 ORDER BY started_at DESC LIMIT $2`,
        [source, limit],
      )
    : await query(user, `SELECT ${COLUMNS} FROM import_jobs ORDER BY started_at DESC LIMIT $1`, [limit])
  return result.rows.map(mapRow)
}

/** Most-recent job for a source — used by the UI to show the latest status. */
export const getLatestImportJob = async (user: string, source: string): Promise<ImportJobEntity | null> => {
  const result = await query(
    user,
    `SELECT ${COLUMNS} FROM import_jobs WHERE source = $1 ORDER BY started_at DESC LIMIT 1`,
    [source],
  )
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null
}

/** Mark pending → running and set the total once the catalog is known. */
export const startImportJob = async (
  user: string,
  id: string,
  totalItems: number,
): Promise<ImportJobEntity | null> => {
  const result = await query(
    user,
    `UPDATE import_jobs SET status = 'running', total_items = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, totalItems],
  )
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null
}

export const updateImportJobProgress = async (
  user: string,
  id: string,
  processedItems: number,
): Promise<void> => {
  await query(user, `UPDATE import_jobs SET processed_items = $2 WHERE id = $1`, [id, processedItems])
}

export const completeImportJob = async (user: string, id: string): Promise<ImportJobEntity | null> => {
  const result = await query(
    user,
    `UPDATE import_jobs
       SET status = 'completed', completed_at = NOW(), error = NULL
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id],
  )
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null
}

export const failImportJob = async (
  user: string,
  id: string,
  errorMessage: string,
): Promise<ImportJobEntity | null> => {
  const result = await query(
    user,
    `UPDATE import_jobs
       SET status = 'failed', completed_at = NOW(), error = $2
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, errorMessage.slice(0, 1000)],
  )
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null
}

/**
 * Mark any "running" jobs older than the cutoff as failed. Called at backend
 * startup so a process crash doesn't leave the UI stuck on "running forever".
 */
export const reapStaleImportJobs = async (user: string, maxAgeMinutes = 60): Promise<number> => {
  const result = await query(
    user,
    `UPDATE import_jobs
       SET status = 'failed', completed_at = NOW(),
           error = 'Backend restarted while job was running'
     WHERE status = 'running'
       AND started_at < NOW() - ($1 || ' minutes')::INTERVAL`,
    [String(maxAgeMinutes)],
  )
  return result.rowCount ?? 0
}
