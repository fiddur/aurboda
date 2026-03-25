import type { Meal, MealFoodItem } from './types.ts'

/**
 * Meals CRUD operations.
 *
 * Meals store food intake data from various sources (Oura, Cronometer, MyFitnessPal, manual).
 */
import { query } from './connection.ts'
import { mapMealRow } from './row-mappers.ts'

const MEAL_COLUMNS =
  'id, source, meal_type, name, time, calories, protein, carbs, fat, fiber, food_items, micros, notes, sensitivities, created_at'

export interface InsertMealInput {
  id?: string
  source?: string
  meal_type?: string
  name?: string
  time: Date
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
  food_items?: MealFoodItem[]
  micros?: Record<string, number>
  notes?: string
  sensitivities?: string[]
}

/**
 * Upsert a meal record.
 * If `id` is provided, inserts with that ID or updates on conflict.
 * This makes the operation idempotent — retries with the same ID are safe.
 */
export const upsertMeal = async (user: string, input: InsertMealInput): Promise<Meal> => {
  const params = [
    input.id ?? null,
    input.source ?? 'manual',
    input.meal_type ?? null,
    input.name ?? null,
    input.time,
    input.calories ?? null,
    input.protein ?? null,
    input.carbs ?? null,
    input.fat ?? null,
    input.fiber ?? null,
    input.food_items ? JSON.stringify(input.food_items) : null,
    input.micros ? JSON.stringify(input.micros) : null,
    input.notes ?? null,
    input.sensitivities ?? null,
  ]

  const sql = input.id
    ? `INSERT INTO meals (id, source, meal_type, name, time, calories, protein, carbs, fat, fiber, food_items, micros, notes, sensitivities)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO UPDATE SET
         source = EXCLUDED.source, meal_type = EXCLUDED.meal_type, name = EXCLUDED.name,
         time = EXCLUDED.time, calories = EXCLUDED.calories, protein = EXCLUDED.protein,
         carbs = EXCLUDED.carbs, fat = EXCLUDED.fat, fiber = EXCLUDED.fiber,
         food_items = EXCLUDED.food_items, micros = EXCLUDED.micros,
         notes = EXCLUDED.notes, sensitivities = EXCLUDED.sensitivities
       RETURNING ${MEAL_COLUMNS}`
    : `INSERT INTO meals (source, meal_type, name, time, calories, protein, carbs, fat, fiber, food_items, micros, notes, sensitivities)
       VALUES ($2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING ${MEAL_COLUMNS}`

  const result = await query(user, sql, params)
  return mapMealRow(result.rows[0])
}

/** @deprecated Use upsertMeal instead. Kept for backwards compatibility. */
export const insertMeal = upsertMeal

/**
 * Get a single meal by ID.
 */
export const getMealById = async (user: string, id: string): Promise<Meal | null> => {
  const result = await query(user, `SELECT ${MEAL_COLUMNS} FROM meals WHERE id = $1`, [id])

  if (result.rows.length === 0) return null
  return mapMealRow(result.rows[0])
}

interface QueryMealsFilter {
  meal_type?: string
  start?: Date
  end?: Date
}

/**
 * Query meals with optional filters.
 */
export const getMeals = async (user: string, filter: QueryMealsFilter): Promise<Meal[]> => {
  let sql = `SELECT ${MEAL_COLUMNS} FROM meals WHERE 1=1`
  const params: unknown[] = []
  let paramIdx = 1

  if (filter.meal_type) {
    sql += ` AND meal_type = $${paramIdx++}`
    params.push(filter.meal_type)
  }

  if (filter.start) {
    sql += ` AND time >= $${paramIdx++}`
    params.push(filter.start)
  }

  if (filter.end) {
    sql += ` AND time <= $${paramIdx++}`
    params.push(filter.end)
  }

  sql += ` ORDER BY time DESC`

  const result = await query(user, sql, params)
  return result.rows.map(mapMealRow)
}

export interface UpdateMealInput {
  meal_type?: string
  name?: string | null
  time?: Date
  calories?: number | null
  protein?: number | null
  carbs?: number | null
  fat?: number | null
  fiber?: number | null
  food_items?: MealFoodItem[] | null
  micros?: Record<string, number> | null
  notes?: string | null
  sensitivities?: string[] | null
}

// Fields that map directly from input to SQL column (no serialization needed)
const SIMPLE_UPDATE_FIELDS = [
  'meal_type',
  'name',
  'time',
  'calories',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'notes',
  'sensitivities',
] as const

// Fields that need JSON.stringify for non-null values
const JSONB_UPDATE_FIELDS = ['food_items', 'micros'] as const

/**
 * Update a meal by ID. Only provided fields are changed.
 * Returns null if the meal was not found.
 */
export const updateMeal = async (user: string, id: string, input: UpdateMealInput): Promise<Meal | null> => {
  const setClauses: string[] = []
  const params: unknown[] = []
  let paramIdx = 1

  for (const field of SIMPLE_UPDATE_FIELDS) {
    if (input[field] !== undefined) {
      setClauses.push(`${field} = $${paramIdx++}`)
      params.push(input[field])
    }
  }

  for (const field of JSONB_UPDATE_FIELDS) {
    if (input[field] !== undefined) {
      setClauses.push(`${field} = $${paramIdx++}`)
      params.push(input[field] === null ? null : JSON.stringify(input[field]))
    }
  }

  if (setClauses.length === 0) {
    return getMealById(user, id)
  }

  params.push(id)
  const result = await query(
    user,
    `UPDATE meals SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING ${MEAL_COLUMNS}`,
    params,
  )

  if (result.rows.length === 0) return null
  return mapMealRow(result.rows[0])
}

/**
 * Delete a meal by ID.
 * Returns true if the meal was found and deleted.
 */
export const deleteMeal = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM meals WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

// ============================================================================
// Meal Log Completion
// ============================================================================

/**
 * Get completed dates within a range.
 */
export const getMealLogCompleted = async (user: string, dates: string[]): Promise<string[]> => {
  if (dates.length === 0) return []
  const placeholders = dates.map((_, i) => `$${i + 1}`).join(', ')
  const result = await query(
    user,
    `SELECT date FROM meal_log_completed WHERE date IN (${placeholders})`,
    dates,
  )
  return result.rows.map((r) => r.date.toISOString().slice(0, 10))
}

/**
 * Mark a date as completed.
 */
export const setMealLogCompleted = async (user: string, date: string): Promise<void> => {
  await query(user, `INSERT INTO meal_log_completed (date) VALUES ($1) ON CONFLICT (date) DO NOTHING`, [date])
}

/**
 * Unmark a date as completed.
 */
export const unsetMealLogCompleted = async (user: string, date: string): Promise<void> => {
  await query(user, `DELETE FROM meal_log_completed WHERE date = $1`, [date])
}
