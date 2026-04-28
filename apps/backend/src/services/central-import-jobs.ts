/**
 * Bulk-import job tracking on the central database.
 *
 * Imports target shared (central) reference data, so the job rows live in
 * the central DB too. State machine: pending → running → completed | failed.
 * The runner ticks `last_progress_at` on every progress update; a heartbeat-
 * based reaper marks stalled jobs as failed without killing slow-but-live ones.
 */

import type pg from 'pg'

export interface CentralImportJobEntity {
  id: string
  source: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  started_at: Date
  last_progress_at: Date
  completed_at?: Date
  total_items?: number
  processed_items: number
  skipped_items: number
  error?: string
  started_by?: string
}

export const CREATE_IMPORT_JOBS_TABLE = `
  CREATE TABLE IF NOT EXISTS import_jobs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source            VARCHAR(50) NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending',
    started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_progress_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ,
    total_items       INTEGER,
    processed_items   INTEGER NOT NULL DEFAULT 0,
    skipped_items     INTEGER NOT NULL DEFAULT 0,
    error             TEXT,
    started_by        VARCHAR(255)
  )
`

export const CREATE_IMPORT_JOBS_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_import_jobs_source_started
     ON import_jobs (source, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_import_jobs_active_source
     ON import_jobs (source) WHERE status IN ('pending', 'running')`,
]

const COLUMNS = `
  id, source, status, started_at, last_progress_at, completed_at,
  total_items, processed_items, skipped_items, error, started_by
`.trim()

const mapRow = (row: Record<string, unknown>): CentralImportJobEntity => ({
  completed_at: row.completed_at ? new Date(row.completed_at as string) : undefined,
  error: (row.error as string | null) ?? undefined,
  id: row.id as string,
  last_progress_at: new Date(row.last_progress_at as string),
  processed_items: row.processed_items as number,
  skipped_items: row.skipped_items as number,
  source: row.source as string,
  started_at: new Date(row.started_at as string),
  started_by: (row.started_by as string | null) ?? undefined,
  status: row.status as CentralImportJobEntity['status'],
  total_items: (row.total_items as number | null) ?? undefined,
})

export interface CentralImportJobsApi {
  insertImportJob: (source: string, startedBy?: string) => Promise<CentralImportJobEntity>
  getImportJobById: (id: string) => Promise<CentralImportJobEntity | null>
  getActiveImportJob: (source: string) => Promise<CentralImportJobEntity | null>
  getLatestImportJob: (source: string) => Promise<CentralImportJobEntity | null>
  listImportJobs: (source?: string, limit?: number) => Promise<CentralImportJobEntity[]>
  startImportJob: (id: string, totalItems: number) => Promise<CentralImportJobEntity | null>
  updateImportJobProgress: (id: string, processed: number, skipped: number) => Promise<void>
  completeImportJob: (id: string) => Promise<CentralImportJobEntity | null>
  failImportJob: (id: string, errorMessage: string) => Promise<CentralImportJobEntity | null>
  reapStaleImportJobs: (maxStaleMinutes?: number) => Promise<number>
}

export const createCentralImportJobsApi = (getClient: () => Promise<pg.Client>): CentralImportJobsApi => ({
  insertImportJob: async (source, startedBy) => {
    const client = await getClient()
    const result = await client.query(
      `INSERT INTO import_jobs (source, started_by) VALUES ($1, $2) RETURNING ${COLUMNS}`,
      [source, startedBy ?? null],
    )
    return mapRow(result.rows[0])
  },

  getImportJobById: async (id) => {
    const client = await getClient()
    const result = await client.query(`SELECT ${COLUMNS} FROM import_jobs WHERE id = $1`, [id])
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  },

  getActiveImportJob: async (source) => {
    const client = await getClient()
    const result = await client.query(
      `SELECT ${COLUMNS} FROM import_jobs
       WHERE source = $1 AND status IN ('pending', 'running')
       ORDER BY started_at DESC LIMIT 1`,
      [source],
    )
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  },

  getLatestImportJob: async (source) => {
    const client = await getClient()
    const result = await client.query(
      `SELECT ${COLUMNS} FROM import_jobs WHERE source = $1 ORDER BY started_at DESC LIMIT 1`,
      [source],
    )
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  },

  listImportJobs: async (source, limit = 10) => {
    const client = await getClient()
    const result = source
      ? await client.query(
          `SELECT ${COLUMNS} FROM import_jobs WHERE source = $1 ORDER BY started_at DESC LIMIT $2`,
          [source, limit],
        )
      : await client.query(`SELECT ${COLUMNS} FROM import_jobs ORDER BY started_at DESC LIMIT $1`, [limit])
    return result.rows.map(mapRow)
  },

  startImportJob: async (id, totalItems) => {
    const client = await getClient()
    const result = await client.query(
      `UPDATE import_jobs
         SET status = 'running', total_items = $2, last_progress_at = NOW()
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [id, totalItems],
    )
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  },

  updateImportJobProgress: async (id, processed, skipped) => {
    const client = await getClient()
    await client.query(
      `UPDATE import_jobs
         SET processed_items = $2, skipped_items = $3, last_progress_at = NOW()
       WHERE id = $1`,
      [id, processed, skipped],
    )
  },

  completeImportJob: async (id) => {
    const client = await getClient()
    const result = await client.query(
      `UPDATE import_jobs
         SET status = 'completed', completed_at = NOW(), last_progress_at = NOW(), error = NULL
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [id],
    )
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  },

  failImportJob: async (id, errorMessage) => {
    const client = await getClient()
    const result = await client.query(
      `UPDATE import_jobs
         SET status = 'failed', completed_at = NOW(), last_progress_at = NOW(), error = $2
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [id, errorMessage.slice(0, 1000)],
    )
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  },

  reapStaleImportJobs: async (maxStaleMinutes = 10) => {
    const client = await getClient()
    const result = await client.query(
      `UPDATE import_jobs
         SET status = 'failed', completed_at = NOW(),
             error = 'Backend restarted or stalled while job was running'
       WHERE status IN ('pending', 'running')
         AND last_progress_at < NOW() - INTERVAL '1 minute' * $1`,
      [maxStaleMinutes],
    )
    return result.rowCount ?? 0
  },
})
