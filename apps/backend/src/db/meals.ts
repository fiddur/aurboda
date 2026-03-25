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
 * Insert a meal record.
 */
export const insertMeal = async (user: string, input: InsertMealInput): Promise<Meal> => {
  const result = await query(
    user,
    `INSERT INTO meals (source, meal_type, name, time, calories, protein, carbs, fat, fiber, food_items, micros, notes, sensitivities)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING ${MEAL_COLUMNS}`,
    [
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
    ],
  )

  return mapMealRow(result.rows[0])
}

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

/**
 * Update a meal by ID. Only provided fields are changed.
 * Returns null if the meal was not found.
 */
export const updateMeal = async (user: string, id: string, input: UpdateMealInput): Promise<Meal | null> => {
  const setClauses: string[] = []
  const params: unknown[] = []
  let paramIdx = 1

  const addField = (column: string, value: unknown, serialize?: boolean) => {
    setClauses.push(`${column} = $${paramIdx++}`)
    params.push(serialize ? JSON.stringify(value) : value)
  }

  if (input.meal_type !== undefined) addField('meal_type', input.meal_type)
  if (input.name !== undefined) addField('name', input.name)
  if (input.time !== undefined) addField('time', input.time)
  if (input.calories !== undefined) addField('calories', input.calories)
  if (input.protein !== undefined) addField('protein', input.protein)
  if (input.carbs !== undefined) addField('carbs', input.carbs)
  if (input.fat !== undefined) addField('fat', input.fat)
  if (input.fiber !== undefined) addField('fiber', input.fiber)
  if (input.food_items !== undefined)
    addField('food_items', input.food_items === null ? null : input.food_items, input.food_items !== null)
  if (input.micros !== undefined)
    addField('micros', input.micros === null ? null : input.micros, input.micros !== null)
  if (input.notes !== undefined) addField('notes', input.notes)
  if (input.sensitivities !== undefined) addField('sensitivities', input.sensitivities)

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
