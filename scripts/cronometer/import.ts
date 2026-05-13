#!/usr/bin/env tsx
/**
 * Import Cronometer CSV export into Aurboda.
 *
 * Usage: pnpm tsx scripts/cronometer/import.ts <servings.csv> [dailysummary.csv]
 *
 * Reads auth from ~/.config/aurboda/config (AURBODA_BASE_URL, AURBODA_TOKEN).
 * Uses PUT /meals (idempotent upsert) so re-running is safe.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

// ── Config ───────────────────────────────────────────────────────────────────

const loadConfig = (): { baseUrl: string; token: string } => {
  const configPath = resolve(homedir(), '.config/aurboda/config')
  const content = readFileSync(configPath, 'utf-8')
  const vars: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+)=["']?(.+?)["']?$/)
    if (match) vars[match[1]] = match[2]
  }
  if (!vars.AURBODA_BASE_URL || !vars.AURBODA_TOKEN) {
    throw new Error(`Missing AURBODA_BASE_URL or AURBODA_TOKEN in ${configPath}`)
  }
  return { baseUrl: vars.AURBODA_BASE_URL, token: vars.AURBODA_TOKEN }
}

// ── CSV parsing ──────────────────────────────────────────────────────────────

/** Parse CSV respecting quoted fields. */
const parseCSVLine = (line: string): string[] => {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

const parseCSV = (content: string): Record<string, string>[] => {
  const lines = content.split('\n').filter((l) => l.trim())
  if (lines.length < 2) return []
  const headers = parseCSVLine(lines[0])
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => (row[h] = values[i] ?? ''))
    return row
  })
}

// ── Nutrient mapping ─────────────────────────────────────────────────────────

/** Map Cronometer column header to { key, unit }. */
const parseNutrientColumn = (header: string): { key: string; unit: string } | null => {
  // Pattern: "B1 (Thiamine) (mg)" or "Vitamin C (mg)" or "Energy (kcal)"
  const match = header.match(/^(.+?)\s*\((\w+)\)\s*$/)
  if (!match) return null

  let name = match[1].trim()
  const unit = match[2]

  // Check for nested parens: "B1 (Thiamine) (mg)" -> "B1 (Thiamine)" with unit "mg"
  // The last paren group is the unit
  const fullMatch = header.match(/^(.+)\s+\((\w+)\)$/)
  if (fullMatch) {
    name = fullMatch[1].trim()
    // Remove trailing paren group that might be a sub-name
    // "B1 (Thiamine)" stays as-is, it's the name
  }

  // Normalize name to snake_case key
  const key = name
    .replaceAll(/[()]/g, '')
    .replaceAll(/[\s-]+/g, '_')
    .toLowerCase()

  return { key, unit: unit.toLowerCase() }
}

// Macro fields we extract at the meal/item level (not into micros)
const MACRO_FIELDS = new Set(['energy', 'protein', 'fat', 'carbs', 'net_carbs', 'fiber'])

const SKIP_FIELDS = new Set(['Day', 'Group', 'Food Name', 'Amount', 'Category', 'Completed', 'Date'])

// ── Default meal times ───────────────────────────────────────────────────────

const MEAL_TYPE_HOURS: Record<string, number> = {
  Breakfast: 7,
  Lunch: 12,
  Dinner: 18,
  Snacks: 15,
}

// ── Parse amount string ──────────────────────────────────────────────────────

const parseAmount = (amount: string): { quantity: number; unit: string } => {
  const match = amount.match(/^([\d.]+)\s+(.+)$/)
  if (match) return { quantity: parseFloat(match[1]), unit: match[2] }
  return { quantity: parseFloat(amount) || 1, unit: 'serving' }
}

// ── Build meal from servings ─────────────────────────────────────────────────

interface FoodItem {
  name: string
  quantity?: number
  unit?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
  micros?: Record<string, { value: number; unit: string }>
}

interface MealPayload {
  id: string
  meal_type: string
  time: string
  source: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
  food_items: FoodItem[]
  micros?: Record<string, { value: number; unit: string }>
}

const parseFoodItemMicros = (
  row: Record<string, string>,
  headers: string[],
): Record<string, { value: number; unit: string }> => {
  const micros: Record<string, { value: number; unit: string }> = {}
  for (const header of headers) {
    if (SKIP_FIELDS.has(header)) continue
    const parsed = parseNutrientColumn(header)
    if (!parsed || MACRO_FIELDS.has(parsed.key)) continue
    const val = parseFloat(row[header])
    if (!isNaN(val) && val !== 0) {
      micros[parsed.key] = { value: val, unit: parsed.unit }
    }
  }
  return micros
}

const buildFoodItem = (row: Record<string, string>, headers: string[]): FoodItem => {
  const amount = parseAmount(row.Amount ?? '')
  const micros = parseFoodItemMicros(row, headers)
  const item: FoodItem = { name: row['Food Name'], ...amount }
  const cal = parseFloat(row['Energy (kcal)'])
  if (!isNaN(cal)) item.calories = cal
  const prot = parseFloat(row['Protein (g)'])
  if (!isNaN(prot)) item.protein = prot
  const carb = parseFloat(row['Carbs (g)'])
  if (!isNaN(carb)) item.carbs = carb
  const fat = parseFloat(row['Fat (g)'])
  if (!isNaN(fat)) item.fat = fat
  const fib = parseFloat(row['Fiber (g)'])
  if (!isNaN(fib)) item.fiber = fib
  if (Object.keys(micros).length > 0) item.micros = micros
  return item
}

const aggregateMealNutrients = (meal: MealPayload, foodItems: FoodItem[]): void => {
  const round2 = (n: number) => Math.round(n * 100) / 100
  const totalCal = foodItems.reduce((s, i) => s + (i.calories ?? 0), 0)
  const totalProt = foodItems.reduce((s, i) => s + (i.protein ?? 0), 0)
  const totalCarbs = foodItems.reduce((s, i) => s + (i.carbs ?? 0), 0)
  const totalFat = foodItems.reduce((s, i) => s + (i.fat ?? 0), 0)
  const totalFiber = foodItems.reduce((s, i) => s + (i.fiber ?? 0), 0)

  if (totalCal > 0) meal.calories = round2(totalCal)
  if (totalProt > 0) meal.protein = round2(totalProt)
  if (totalCarbs > 0) meal.carbs = round2(totalCarbs)
  if (totalFat > 0) meal.fat = round2(totalFat)
  if (totalFiber > 0) meal.fiber = round2(totalFiber)

  const mealMicros: Record<string, { value: number; unit: string }> = {}
  for (const item of foodItems) {
    for (const [k, v] of Object.entries(item.micros ?? {})) {
      if (mealMicros[k]) mealMicros[k].value += v.value
      else mealMicros[k] = { ...v }
    }
  }
  if (Object.keys(mealMicros).length > 0) meal.micros = mealMicros
}

const buildMeals = (servings: Record<string, string>[]): MealPayload[] => {
  // Group by Day + Group (meal type)
  const grouped = new Map<string, Record<string, string>[]>()
  for (const row of servings) {
    const key = `${row.Day}|${row.Group}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(row)
  }

  const headers = Object.keys(servings[0] ?? {})
  const meals: MealPayload[] = []

  for (const [key, rows] of grouped) {
    const [day, group] = key.split('|')
    const hour = MEAL_TYPE_HOURS[group] ?? 12
    const time = `${day}T${String(hour).padStart(2, '0')}:00:00Z`
    const mealType = group.toLowerCase().replace('snacks', 'snack')

    const foodItems: FoodItem[] = rows.map((row) => buildFoodItem(row, headers))

    const meal: MealPayload = {
      id: randomUUID(),
      meal_type: mealType,
      time,
      source: 'cronometer',
      food_items: foodItems,
    }
    aggregateMealNutrients(meal, foodItems)
    meals.push(meal)
  }

  return meals.sort((a, b) => a.time.localeCompare(b.time))
}

// ── API calls ────────────────────────────────────────────────────────────────

const upsertMeal = async (baseUrl: string, token: string, meal: MealPayload): Promise<void> => {
  const response = await fetch(`${baseUrl}/api/meals`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(meal),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`PUT /meals failed (${response.status}): ${text}`)
  }
}

const setLogCompleted = async (baseUrl: string, token: string, date: string): Promise<void> => {
  await fetch(`${baseUrl}/api/meals/log-completed/${date}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  })
}

// ── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  const args = process.argv.slice(2)
  if (args.length < 1) {
    console.error('Usage: pnpm tsx scripts/cronometer/import.ts <servings.csv> [dailysummary.csv]')
    process.exit(1)
  }

  const config = loadConfig()
  console.log(`🔑 Using API at ${config.baseUrl}`)

  // Parse servings
  const servingsPath = resolve(args[0])
  console.log(`📄 Reading ${servingsPath}`)
  const servingsContent = readFileSync(servingsPath, 'utf-8')
  const servings = parseCSV(servingsContent)
  console.log(`   ${servings.length} food item rows`)

  // Build meals
  const meals = buildMeals(servings)
  console.log(`🍽️  Built ${meals.length} meals from ${new Set(servings.map((r) => r.Day)).size} days`)

  // Import meals
  let imported = 0
  let failed = 0
  for (const meal of meals) {
    try {
      await upsertMeal(config.baseUrl, config.token, meal)
      imported++
      process.stdout.write(`\r   ✅ ${imported}/${meals.length} imported`)
    } catch (err) {
      failed++
      console.error(`\n   ❌ Failed: ${meal.time} ${meal.meal_type}: ${err}`)
    }
  }
  console.log(`\n   📊 ${imported} imported, ${failed} failed`)

  // Handle daily summary for log_completed
  if (args[1]) {
    const summaryPath = resolve(args[1])
    console.log(`📄 Reading ${summaryPath}`)
    const summaryContent = readFileSync(summaryPath, 'utf-8')
    const summary = parseCSV(summaryContent)
    const completed = summary.filter((r) => r.Completed === 'true').map((r) => r.Date)
    console.log(`   ${completed.length} completed days`)
    for (const date of completed) {
      await setLogCompleted(config.baseUrl, config.token, date)
    }
    console.log(`   ✅ Marked ${completed.length} days as logging-complete`)
  }

  console.log('🎉 Done!')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
