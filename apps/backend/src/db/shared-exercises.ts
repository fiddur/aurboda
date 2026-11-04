import { randomBytes } from 'node:crypto'

import { normalizeItemValue } from '../services/activity-measures.ts'
import { query } from './connection.ts'
import { publicSlugIsFree } from './public-slugs.ts'

export interface SharedExerciseRecord {
  id: string
  slug: string
  activity_type: string
  field: string
  value: string
  name: string
  is_public: boolean
  created_at: Date
  updated_at: Date
}

export interface SharedExerciseInput {
  activity_type: string
  field: string
  value: string
  name: string
  is_public: boolean
}

export interface SharedExercisePatch {
  name?: string
  is_public?: boolean
}

const COLUMNS = 'id, slug, activity_type, field, value, name, is_public, created_at, updated_at'

const ITEM_CONSTRAINT = 'shared_exercises_item_key'

const mapRow = (row: SharedExerciseRecord): SharedExerciseRecord => ({
  activity_type: row.activity_type,
  created_at: row.created_at,
  field: row.field,
  id: row.id,
  is_public: row.is_public,
  name: row.name,
  slug: row.slug,
  updated_at: row.updated_at,
  value: row.value,
})

const generateSlug = (): string => randomBytes(7).toString('base64url')

type PgError = Error & { code?: string; constraint?: string }

const isUniqueViolation = (error: unknown): error is PgError =>
  error instanceof Error && (error as PgError).code === '23505'

/** The error `createSharedExercise` throws when the item is already shared. */
export const isDuplicateSharedExercise = (error: unknown): boolean =>
  isUniqueViolation(error) && error.constraint === ITEM_CONSTRAINT

/** The error `createSharedExercise` throws when the activity type does not exist. */
export const isUnknownSharedExerciseType = (error: unknown): boolean =>
  error instanceof Error && (error as PgError).code === '23503'

export const listSharedExercises = async (user: string): Promise<SharedExerciseRecord[]> => {
  const result = await query<SharedExerciseRecord>(
    user,
    `SELECT ${COLUMNS} FROM shared_exercises ORDER BY created_at DESC`,
  )
  return result.rows.map(mapRow)
}

export const listPublicSharedExercises = async (user: string): Promise<SharedExerciseRecord[]> => {
  const result = await query<SharedExerciseRecord>(
    user,
    `SELECT ${COLUMNS} FROM shared_exercises WHERE is_public = true ORDER BY created_at DESC`,
  )
  return result.rows.map(mapRow)
}

const getOne = async (
  user: string,
  where: string,
  params: unknown[],
): Promise<SharedExerciseRecord | null> => {
  const result = await query<SharedExerciseRecord>(
    user,
    `SELECT ${COLUMNS} FROM shared_exercises WHERE ${where}`,
    params,
  )
  return result.rows.length === 0 ? null : mapRow(result.rows[0])
}

export const getSharedExerciseById = (user: string, id: string): Promise<SharedExerciseRecord | null> =>
  getOne(user, 'id = $1', [id])

export const getSharedExerciseBySlug = (user: string, slug: string): Promise<SharedExerciseRecord | null> =>
  getOne(user, 'slug = $1', [slug])

export const findSharedExercise = (
  user: string,
  activityType: string,
  field: string,
  value: string,
): Promise<SharedExerciseRecord | null> =>
  getOne(user, 'activity_type = $1 AND field = $2 AND value = $3', [activityType, field, value])

export const createSharedExercise = async (
  user: string,
  input: SharedExerciseInput,
): Promise<SharedExerciseRecord> => {
  const maxAttempts = 5
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const slug = generateSlug()
    if (!(await publicSlugIsFree(user, slug))) continue
    try {
      const result = await query<SharedExerciseRecord>(
        user,
        `INSERT INTO shared_exercises (slug, activity_type, field, value, name, is_public)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${COLUMNS}`,
        [slug, input.activity_type, input.field, input.value, input.name, input.is_public],
      )
      return mapRow(result.rows[0])
    } catch (error) {
      if (!isUniqueViolation(error) || isDuplicateSharedExercise(error)) throw error
    }
  }
  throw new Error(`Failed to generate a unique shared exercise slug after ${maxAttempts} attempts`)
}

export const updateSharedExercise = async (
  user: string,
  id: string,
  patch: SharedExercisePatch,
): Promise<SharedExerciseRecord | null> => {
  const sets: string[] = []
  const params: unknown[] = []
  if (patch.name !== undefined) {
    params.push(patch.name)
    sets.push(`name = $${params.length}`)
  }
  if (patch.is_public !== undefined) {
    params.push(patch.is_public)
    sets.push(`is_public = $${params.length}`)
  }
  if (sets.length === 0) return getSharedExerciseById(user, id)
  params.push(id)
  const result = await query<SharedExerciseRecord>(
    user,
    `UPDATE shared_exercises SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length} RETURNING ${COLUMNS}`,
    params,
  )
  return result.rows.length === 0 ? null : mapRow(result.rows[0])
}

export const deleteSharedExercise = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM shared_exercises WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

/**
 * Move shares of `source` (trimmed, case-insensitive, as `rewriteItemValue` matches it) in `field`
 * of `activityTypes` to `target`. An item is shared at most once, so where the type already shares
 * `target`, or several spellings of `source` are shared, only the oldest share survives the move.
 */
export const repointSharedExercises = async (
  user: string,
  activityTypes: string[],
  field: string,
  source: string,
  target: string,
): Promise<number> => {
  const normalizedSource = normalizeItemValue(source)
  if (activityTypes.length === 0 || normalizedSource === undefined) return 0
  const params = [activityTypes, field, normalizedSource, target.trim()]
  const matches = `activity_type = ANY($1) AND field = $2 AND lower(btrim(value)) = $3 AND value <> $4`
  await query(
    user,
    `WITH sources AS (
       SELECT s.id,
              row_number() OVER (PARTITION BY s.activity_type ORDER BY s.created_at, s.id) AS rn,
              EXISTS (
                SELECT 1 FROM shared_exercises t
                WHERE t.activity_type = s.activity_type AND t.field = s.field AND t.value = $4
              ) AS taken
       FROM shared_exercises s
       WHERE ${matches}
     )
     DELETE FROM shared_exercises WHERE id IN (SELECT id FROM sources WHERE taken OR rn > 1)`,
    params,
  )
  const result = await query(
    user,
    `UPDATE shared_exercises SET value = $4, updated_at = NOW() WHERE ${matches}`,
    params,
  )
  return result.rowCount ?? 0
}
