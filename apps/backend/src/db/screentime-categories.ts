import type { ScreentimeCategory, ScreentimeCategoryInput } from './types.ts'

/**
 * Screentime category storage and retrieval.
 */
import { query } from './connection.ts'

const mapRow = (row: Record<string, unknown>): ScreentimeCategory => ({
  color: (row.color as string) || undefined,
  created_at: new Date(row.created_at as string),
  id: row.id as string,
  ignore_case: row.ignore_case as boolean,
  name: row.name as string[],
  rule_regex: (row.rule_regex as string) || undefined,
  rule_type: row.rule_type as 'regex' | 'none',
  score: row.score != null ? (row.score as number) : undefined,
  sort_order: row.sort_order as number,
  updated_at: new Date(row.updated_at as string),
})

export const getScreentimeCategories = async (user: string): Promise<ScreentimeCategory[]> => {
  const result = await query(
    user,
    `SELECT id, name, rule_type, rule_regex, ignore_case, color, score, sort_order, created_at, updated_at
     FROM screentime_categories
     ORDER BY sort_order, name`,
  )

  return result.rows.map(mapRow)
}

export const getScreentimeCategoryById = async (
  user: string,
  id: string,
): Promise<ScreentimeCategory | null> => {
  const result = await query(
    user,
    `SELECT id, name, rule_type, rule_regex, ignore_case, color, score, sort_order, created_at, updated_at
     FROM screentime_categories
     WHERE id = $1`,
    [id],
  )

  return result.rows.length > 0 ? mapRow(result.rows[0]) : null
}

export const insertScreentimeCategory = async (
  user: string,
  input: ScreentimeCategoryInput,
): Promise<ScreentimeCategory> => {
  const result = await query(
    user,
    `INSERT INTO screentime_categories (name, rule_type, rule_regex, ignore_case, color, score, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, rule_type, rule_regex, ignore_case, color, score, sort_order, created_at, updated_at`,
    [
      input.name,
      input.rule_type,
      input.rule_regex || null,
      input.ignore_case ?? true,
      input.color || null,
      input.score ?? null,
      input.sort_order ?? 0,
    ],
  )

  return mapRow(result.rows[0])
}

export const updateScreentimeCategory = async (
  user: string,
  id: string,
  input: Partial<ScreentimeCategoryInput>,
): Promise<ScreentimeCategory | null> => {
  const fields: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if (input.name !== undefined) {
    fields.push(`name = $${paramIndex++}`)
    values.push(input.name)
  }
  if (input.rule_type !== undefined) {
    fields.push(`rule_type = $${paramIndex++}`)
    values.push(input.rule_type)
  }
  if (input.rule_regex !== undefined) {
    fields.push(`rule_regex = $${paramIndex++}`)
    values.push(input.rule_regex || null)
  }
  if (input.ignore_case !== undefined) {
    fields.push(`ignore_case = $${paramIndex++}`)
    values.push(input.ignore_case)
  }
  if (input.color !== undefined) {
    fields.push(`color = $${paramIndex++}`)
    values.push(input.color || null)
  }
  if (input.score !== undefined) {
    fields.push(`score = $${paramIndex++}`)
    values.push(input.score)
  }
  if (input.sort_order !== undefined) {
    fields.push(`sort_order = $${paramIndex++}`)
    values.push(input.sort_order)
  }

  if (fields.length === 0) return getScreentimeCategoryById(user, id)

  fields.push(`updated_at = NOW()`)
  values.push(id)

  const result = await query(
    user,
    `UPDATE screentime_categories
     SET ${fields.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING id, name, rule_type, rule_regex, ignore_case, color, score, sort_order, created_at, updated_at`,
    values,
  )

  return result.rows.length > 0 ? mapRow(result.rows[0]) : null
}

/**
 * Delete a category and all its children (categories whose name path starts with the target's name).
 * Returns the number of deleted categories.
 */
export const deleteScreentimeCategoryWithChildren = async (user: string, id: string): Promise<number> => {
  // First, get the category to find its name path
  const cat = await getScreentimeCategoryById(user, id)
  if (!cat) return 0

  // Delete all categories whose name starts with this category's name path.
  // name[1:N] extracts a slice; compare against the parent's name array.
  const result = await query(
    user,
    `DELETE FROM screentime_categories
     WHERE name[1:$1] = $2`,
    [cat.name.length, cat.name],
  )

  return result.rowCount ?? 0
}

/**
 * Delete all screentime categories (used before import).
 */
export const deleteAllScreentimeCategories = async (user: string): Promise<void> => {
  await query(user, `DELETE FROM screentime_categories`)
}

/**
 * Bulk insert screentime categories (used for import).
 */
export const bulkInsertScreentimeCategories = async (
  user: string,
  categories: ScreentimeCategoryInput[],
): Promise<ScreentimeCategory[]> => {
  if (categories.length === 0) return []

  // Build parameterized VALUES clause to handle PostgreSQL arrays correctly.
  const params: unknown[] = []
  const valueClauses: string[] = []

  for (let i = 0; i < categories.length; i++) {
    const c = categories[i]
    const offset = i * 7
    valueClauses.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`,
    )
    params.push(
      c.name,
      c.rule_type,
      c.rule_regex || null,
      c.ignore_case ?? true,
      c.color || null,
      c.score ?? null,
      c.sort_order ?? i,
    )
  }

  const result = await query(
    user,
    `INSERT INTO screentime_categories (name, rule_type, rule_regex, ignore_case, color, score, sort_order)
     VALUES ${valueClauses.join(', ')}
     RETURNING id, name, rule_type, rule_regex, ignore_case, color, score, sort_order, created_at, updated_at`,
    params,
  )

  return result.rows.map(mapRow)
}
