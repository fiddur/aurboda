import type { DashboardConfig } from '@aurboda/api-spec'

import { randomBytes } from 'node:crypto'

/**
 * Shared dashboards CRUD.
 *
 * Lives in the user's own database. The `slug` is a url-safe random token that
 * acts as the capability for unlisted shares; `is_public` only governs whether
 * a share is listed on the public profile.
 */
import { query } from './connection.ts'

export interface SharedDashboardRecord {
  id: string
  slug: string
  name: string
  config: DashboardConfig
  is_public: boolean
  created_at: Date
  updated_at: Date
}

export interface SharedDashboardInput {
  name: string
  config: DashboardConfig
  is_public: boolean
}

export interface SharedDashboardPatch {
  name?: string
  config?: DashboardConfig
  is_public?: boolean
}

const COLUMNS = 'id, slug, name, config, is_public, created_at, updated_at'

interface SharedDashboardRow {
  id: string
  slug: string
  name: string
  config: DashboardConfig
  is_public: boolean
  created_at: Date
  updated_at: Date
}

const mapRow = (row: SharedDashboardRow): SharedDashboardRecord => ({
  config: row.config,
  created_at: row.created_at,
  id: row.id,
  is_public: row.is_public,
  name: row.name,
  slug: row.slug,
  updated_at: row.updated_at,
})

/** ~9-char url-safe random slug (base64url of 7 random bytes). */
const generateSlug = (): string => randomBytes(7).toString('base64url')

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Error && (error as Error & { code?: string }).code === '23505'

export const listSharedDashboards = async (user: string): Promise<SharedDashboardRecord[]> => {
  const result = await query<SharedDashboardRow>(
    user,
    `SELECT ${COLUMNS} FROM shared_dashboards ORDER BY created_at DESC`,
  )
  return result.rows.map(mapRow)
}

export const listPublicSharedDashboards = async (user: string): Promise<SharedDashboardRecord[]> => {
  const result = await query<SharedDashboardRow>(
    user,
    `SELECT ${COLUMNS} FROM shared_dashboards WHERE is_public = true ORDER BY created_at DESC`,
  )
  return result.rows.map(mapRow)
}

export const getSharedDashboardById = async (
  user: string,
  id: string,
): Promise<SharedDashboardRecord | null> => {
  const result = await query<SharedDashboardRow>(
    user,
    `SELECT ${COLUMNS} FROM shared_dashboards WHERE id = $1`,
    [id],
  )
  if (result.rows.length === 0) return null
  return mapRow(result.rows[0])
}

export const getSharedDashboardBySlug = async (
  user: string,
  slug: string,
): Promise<SharedDashboardRecord | null> => {
  const result = await query<SharedDashboardRow>(
    user,
    `SELECT ${COLUMNS} FROM shared_dashboards WHERE slug = $1`,
    [slug],
  )
  if (result.rows.length === 0) return null
  return mapRow(result.rows[0])
}

export const createSharedDashboard = async (
  user: string,
  input: SharedDashboardInput,
): Promise<SharedDashboardRecord> => {
  const maxAttempts = 5
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const slug = generateSlug()
    try {
      const result = await query<SharedDashboardRow>(
        user,
        `INSERT INTO shared_dashboards (slug, name, config, is_public)
         VALUES ($1, $2, $3::jsonb, $4)
         RETURNING ${COLUMNS}`,
        [slug, input.name, JSON.stringify(input.config), input.is_public],
      )
      return mapRow(result.rows[0])
    } catch (error) {
      // Retry only on slug collision; rethrow anything else.
      if (isUniqueViolation(error) && attempt < maxAttempts - 1) continue
      throw error
    }
  }
  throw new Error('Failed to generate a unique shared dashboard slug')
}

export const updateSharedDashboard = async (
  user: string,
  id: string,
  patch: SharedDashboardPatch,
): Promise<SharedDashboardRecord | null> => {
  const sets: string[] = []
  const params: unknown[] = []
  let idx = 1

  if (patch.name !== undefined) {
    sets.push(`name = $${idx++}`)
    params.push(patch.name)
  }
  if (patch.config !== undefined) {
    sets.push(`config = $${idx++}::jsonb`)
    params.push(JSON.stringify(patch.config))
  }
  if (patch.is_public !== undefined) {
    sets.push(`is_public = $${idx++}`)
    params.push(patch.is_public)
  }

  if (sets.length === 0) return getSharedDashboardById(user, id)

  sets.push('updated_at = NOW()')
  params.push(id)

  const result = await query<SharedDashboardRow>(
    user,
    `UPDATE shared_dashboards SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${COLUMNS}`,
    params,
  )
  if (result.rows.length === 0) return null
  return mapRow(result.rows[0])
}

export const deleteSharedDashboard = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM shared_dashboards WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}
