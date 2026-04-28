/**
 * CRUD + state transitions for the import_jobs table.
 *
 * State diagram: pending → running → completed | failed.
 * The runner sets total_items once the catalog is fetched, then ticks
 * processed_items as it goes. last_progress_at is touched on every tick so
 * the reaper can use it as a liveness signal (no false-positive reaps for a
 * legitimately slow run).
 */

import type { ImportJobEntity } from './types.ts'

import { query } from './connection.ts'

const COLUMNS = `
  id, source, status, started_at, last_progress_at, completed_at,
  total_items, processed_items, skipped_items, error, started_by
`.trim()

const mapRow = (row: Record<string, unknown>): ImportJobEntity => ({
  completed_at: row.completed_at ? new Date(row.completed_at as string) : undefined,
  error: (row.error as string | null) ?? undefined,
  id: row.id as string,
  last_progress_at: new Date(row.last_progress_at as string),
  processed_items: row.processed_items as number,
  skipped_items: row.skipped_items as number,
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

export const getLatestImportJob = async (user: string, source: string): Promise<ImportJobEntity | null> => {
  const result = await query(
    user,
    `SELECT ${COLUMNS} FROM import_jobs WHERE source = $1 ORDER BY started_at DESC LIMIT 1`,
    [source],
  )
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null
}

/**
 * Single-flight guard. Returns the current pending/running job for `source`,
 * or null if there is none. Callers should return this instead of starting
 * another import (prevents two browser tabs from spawning parallel runs).
 */
export const getActiveImportJob = async (user: string, source: string): Promise<ImportJobEntity | null> => {
  const result = await query(
    user,
    `SELECT ${COLUMNS} FROM import_jobs
     WHERE source = $1 AND status IN ('pending', 'running')
     ORDER BY started_at DESC LIMIT 1`,
    [source],
  )
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null
}

export const startImportJob = async (
  user: string,
  id: string,
  totalItems: number,
): Promise<ImportJobEntity | null> => {
  const result = await query(
    user,
    `UPDATE import_jobs
       SET status = 'running', total_items = $2, last_progress_at = NOW()
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, totalItems],
  )
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null
}

export const updateImportJobProgress = async (
  user: string,
  id: string,
  processedItems: number,
  skippedItems: number,
): Promise<void> => {
  await query(
    user,
    `UPDATE import_jobs
       SET processed_items = $2, skipped_items = $3, last_progress_at = NOW()
     WHERE id = $1`,
    [id, processedItems, skippedItems],
  )
}

export const completeImportJob = async (user: string, id: string): Promise<ImportJobEntity | null> => {
  const result = await query(
    user,
    `UPDATE import_jobs
       SET status = 'completed', completed_at = NOW(), last_progress_at = NOW(), error = NULL
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
       SET status = 'failed', completed_at = NOW(), last_progress_at = NOW(), error = $2
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    // 1000-char cap defends against pathological exception messages blowing
    // out the row size; the column itself is TEXT so any value <= 1 KiB fits.
    [id, errorMessage.slice(0, 1000)],
  )
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null
}

/**
 * Reap jobs whose heartbeat (last_progress_at) hasn't advanced in
 * `maxStaleMinutes`. Uses liveness, not job age, so a slow but progressing
 * import is never killed.
 */
export const reapStaleImportJobs = async (user: string, maxStaleMinutes = 10): Promise<number> => {
  const result = await query(
    user,
    `UPDATE import_jobs
       SET status = 'failed', completed_at = NOW(),
           error = 'Backend restarted or stalled while job was running'
     WHERE status IN ('pending', 'running')
       AND last_progress_at < NOW() - INTERVAL '1 minute' * $1`,
    [maxStaleMinutes],
  )
  return result.rowCount ?? 0
}
