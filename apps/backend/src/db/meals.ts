import type { Meal, MealFoodItem, Micros } from './types.ts'

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
  micros?: Micros
  notes?: string
  sensitivities?: string[]
}

/**
 * Upsert a meal record.
 * If `id` is provided, inserts with that ID or updates on conflict.
 * This makes the operation idempotent — retries with the same ID are safe.
 */
export const upsertMeal = async (user: string, input: InsertMealInput): Promise<Meal> => {
  const commonParams = [
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

  const result = input.id
    ? await query(
        user,
        `INSERT INTO meals (id, source, meal_type, name, time, calories, protein, carbs, fat, fiber, food_items, micros, notes, sensitivities)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET
           source = EXCLUDED.source, meal_type = EXCLUDED.meal_type, name = EXCLUDED.name,
           time = EXCLUDED.time, calories = EXCLUDED.calories, protein = EXCLUDED.protein,
           carbs = EXCLUDED.carbs, fat = EXCLUDED.fat, fiber = EXCLUDED.fiber,
           food_items = EXCLUDED.food_items, micros = EXCLUDED.micros,
           notes = EXCLUDED.notes, sensitivities = EXCLUDED.sensitivities
         RETURNING ${MEAL_COLUMNS}`,
        [input.id, ...commonParams],
      )
    : await query(
        user,
        `INSERT INTO meals (source, meal_type, name, time, calories, protein, carbs, fat, fiber, food_items, micros, notes, sensitivities)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING ${MEAL_COLUMNS}`,
        commonParams,
      )
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

/** Nutrient keys that have authoritative meal-level total columns. */
export const NUTRIENT_KEYS = ['calories', 'protein', 'carbs', 'fat', 'fiber'] as const

export type NutrientKey = (typeof NUTRIENT_KEYS)[number]

/** Per-day total for a single nutrient. */
export interface DailyNutrientTotal {
  date: string
  nutrient: NutrientKey
  total: number
}

/**
 * Sum meal-level nutrient totals per day over an inclusive [start, end] range.
 *
 * Uses the authoritative meal-level macro columns (calories/protein/carbs/fat/
 * fiber), which are kept in sync with the food-item junction (auto-filled from
 * the junction sum unless the caller supplied explicit meal-level macros). Only
 * days that have at least one meal appear in the result; the caller combines
 * this with `meal_log_completed` to know which zero days are true zeros.
 *
 * Days are bucketed by the UTC calendar date (deterministic regardless of the
 * DB session timezone), matching the UTC day-bucketing the correlation daily
 * matrix uses so nutrients align with metrics and events.
 */
export const getDailyNutrientTotals = async (
  user: string,
  nutrients: NutrientKey[],
  start: Date,
  end: Date,
): Promise<DailyNutrientTotal[]> => {
  const requested = nutrients.filter((n) => NUTRIENT_KEYS.includes(n))
  if (requested.length === 0) return []

  // Column names come from the fixed NUTRIENT_KEYS whitelist, so interpolation is safe.
  const sums = requested.map((n) => `COALESCE(SUM(${n}), 0) AS ${n}`).join(', ')
  // TO_CHAR keeps the date as a string so the Node process timezone can't shift
  // it; AT TIME ZONE 'UTC' makes the day boundary the UTC midnight.
  const result = await query(
    user,
    `SELECT TO_CHAR((time AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date, ${sums}
       FROM meals
       WHERE time >= $1 AND time <= $2
       GROUP BY (time AT TIME ZONE 'UTC')::date
       ORDER BY (time AT TIME ZONE 'UTC')::date`,
    [start, end],
  )

  const totals: DailyNutrientTotal[] = []
  for (const row of result.rows) {
    const date = row.date as string
    for (const nutrient of requested) {
      totals.push({ date, nutrient, total: Number(row[nutrient]) })
    }
  }
  return totals
}

/**
 * UTC days in the inclusive [start, end] range that have *real* nutrition
 * logged — at least one meal with a non-null `calories` value.
 *
 * Distinguishes nutrition-complete days from flag-only days (a meal logged with
 * no macros), which otherwise sum to 0 in getDailyNutrientTotals and contaminate
 * nutrient correlations by inflating n with noisy zeros. Bucketed by UTC date to
 * match the correlation daily matrix.
 */
export const getNutritionCompleteDaysInRange = async (
  user: string,
  start: Date,
  end: Date,
): Promise<string[]> => {
  const result = await query(
    user,
    `SELECT DISTINCT TO_CHAR((time AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date
       FROM meals
       WHERE time >= $1 AND time <= $2 AND calories IS NOT NULL
       ORDER BY date`,
    [start, end],
  )
  return result.rows.map((r) => r.date as string)
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
  micros?: Micros | null
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

export interface FrequentMealRow {
  name: string
  meal_type: string
  count: number
  last_time: Date
  last_meal_id: string
}

interface FrequentMealsFilter {
  meal_type: string
  limit: number
  since_days: number
}

/**
 * Group meals by `name` within a meal_type and return the most-frequently-logged
 * names alongside the most recent occurrence's id (for follow-up enrichment of
 * food items / icon).
 */
export const getFrequentMeals = async (
  user: string,
  filter: FrequentMealsFilter,
): Promise<FrequentMealRow[]> => {
  const sql = `
    WITH recent AS (
      SELECT name, meal_type, time, id,
             COUNT(*) OVER (PARTITION BY name) AS name_count,
             ROW_NUMBER() OVER (PARTITION BY name ORDER BY time DESC) AS rn
      FROM meals
      WHERE meal_type = $1
        AND name IS NOT NULL AND name <> ''
        AND time > NOW() - ($2::int || ' days')::interval
    )
    SELECT name, meal_type, time AS last_time, id AS last_meal_id, name_count AS count
    FROM recent
    WHERE rn = 1
    ORDER BY name_count DESC, time DESC
    LIMIT $3
  `
  const result = await query(user, sql, [filter.meal_type, filter.since_days, filter.limit])
  return result.rows.map((row) => ({
    name: row.name as string,
    meal_type: row.meal_type as string,
    count: Number(row.count),
    last_time: row.last_time as Date,
    last_meal_id: row.last_meal_id as string,
  }))
}

// ============================================================================
// Frequent food items
// ============================================================================

export interface FrequentFoodItemRow {
  food_item_id: string
  count: number
  last_used: Date
  last_quantity: number | null
  last_unit: string | null
  /** Last-known name from the most recent row's legacy snapshot column. Read-only fallback for hard-deleted food items; current name is resolved live by the service layer. */
  legacy_name: string | null
  /** Last-known icon. See `legacy_name`. */
  legacy_icon: string | null
}

interface FrequentFoodItemsFilter {
  limit: number
  since_days: number
  /** Optional: scope to a single meal_type (e.g. "breakfast"). */
  meal_type?: string
}

/**
 * Aggregate `meal_food_items` to surface the food items the user logs most
 * often. Useful for an MCP agent to suggest "your usual" without re-running
 * fuzzy search every time, and as the data behind the per-slot quick-log
 * chips on the meals overview.
 *
 * Returns only the food_item_id + usage stats — current name/icon are
 * resolved live by the service layer against the canonical food_item, since
 * those are presentation values that should reflect the latest edits, not
 * a frozen snapshot.
 *
 * When `meal_type` is provided, only meal_food_items linked to meals of
 * that type are counted.
 */
export const getFrequentFoodItems = async (
  user: string,
  filter: FrequentFoodItemsFilter,
): Promise<FrequentFoodItemRow[]> => {
  const params: unknown[] = [filter.since_days, filter.limit]
  let mealTypeClause = ''
  if (filter.meal_type) {
    params.push(filter.meal_type)
    mealTypeClause = `AND m.meal_type = $${params.length}`
  }
  const sql = `
    WITH ranked AS (
      SELECT mfi.food_item_id, mfi.quantity, mfi.unit, m.time,
             mfi.food_item_name AS legacy_name, mfi.food_item_icon AS legacy_icon,
             COUNT(*) OVER (PARTITION BY mfi.food_item_id) AS use_count,
             ROW_NUMBER() OVER (PARTITION BY mfi.food_item_id ORDER BY m.time DESC) AS rn
      FROM meal_food_items mfi
      JOIN meals m ON m.id = mfi.meal_id
      WHERE m.time > NOW() - ($1::int || ' days')::interval
        AND mfi.food_item_id IS NOT NULL
        ${mealTypeClause}
    )
    SELECT food_item_id, quantity, unit, legacy_name, legacy_icon,
           time AS last_used, use_count AS count
    FROM ranked
    WHERE rn = 1
    ORDER BY use_count DESC, time DESC
    LIMIT $2
  `
  const result = await query(user, sql, params)
  return result.rows.map((row) => ({
    count: Number(row.count),
    food_item_id: row.food_item_id as string,
    last_quantity: row.quantity === null ? null : Number(row.quantity),
    last_unit: (row.unit as string | null) ?? null,
    last_used: row.last_used as Date,
    legacy_icon: (row.legacy_icon as string | null) ?? null,
    legacy_name: (row.legacy_name as string | null) ?? null,
  }))
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
 * Get which of the given YYYY-MM-DD dates are marked log-completed.
 *
 * Formats the date in SQL with TO_CHAR — a DATE column comes back as a JS
 * Date at midnight in the Node process's local tz, and toISOString then
 * shifts to UTC, which can drop the date back a day in any env east of UTC.
 */
export const getMealLogCompleted = async (user: string, dates: string[]): Promise<string[]> => {
  if (dates.length === 0) return []
  const placeholders = dates.map((_, i) => `$${i + 1}`).join(', ')
  const result = await query(
    user,
    `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date FROM meal_log_completed
       WHERE date IN (${placeholders})`,
    dates,
  )
  return result.rows.map((r) => r.date as string)
}

/**
 * Get all completed dates within an inclusive [start, end] YYYY-MM-DD range.
 *
 * Formats the date in SQL with TO_CHAR rather than `date.toISOString().slice(0,10)`
 * — a DATE column comes back as a JS Date at midnight in the Node process's
 * local tz, and toISOString then shifts to UTC, which can drop the date back
 * a day in any env east of UTC.
 */
export const getMealLogCompletedInRange = async (
  user: string,
  start: string,
  end: string,
): Promise<string[]> => {
  const result = await query(
    user,
    `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date FROM meal_log_completed
       WHERE date >= $1 AND date <= $2`,
    [start, end],
  )
  return result.rows.map((r) => r.date as string)
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
