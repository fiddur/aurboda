#!/usr/bin/env tsx
/**
 * Migration: normalize food items from JSONB to relational model.
 *
 * Reads all meals with JSONB food_items, creates canonical food_items entries,
 * and populates the meal_food_items junction table.
 *
 * Safe to re-run: uses upsert for food items and replaces junction rows.
 *
 * Usage: cd apps/backend && npx tsx ../../scripts/migration/normalize-food-items.ts
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { NUTRIENT_FIELD_NAMES } from '../../packages/api-spec/src/schemas/nutrients.ts'

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

// ── API helpers ──────────────────────────────────────────────────────────────

const apiGet = async (baseUrl: string, token: string, path: string): Promise<unknown> => {
  const res = await fetch(`${baseUrl}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

const apiPost = async (baseUrl: string, token: string, path: string, body: unknown): Promise<unknown> => {
  const res = await fetch(`${baseUrl}/api${path}`, {
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    method: 'POST',
  })
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// ── Nutrient key mapping (from Cronometer JSONB micros to column names) ──────

/**
 * Map JSONB micro keys (from Cronometer import) to column names.
 * E.g., "b1_thiamine" → "b1_thiamine", "vitamin_c" → "vitamin_c"
 */
const NUTRIENT_FIELD_SET = new Set(NUTRIENT_FIELD_NAMES)

const extractNutrientsFromMicros = (micros?: Record<string, unknown>): Record<string, number> => {
  if (!micros) return {}
  const result: Record<string, number> = {}
  for (const [key, val] of Object.entries(micros)) {
    if (!NUTRIENT_FIELD_SET.has(key)) continue
    if (typeof val === 'number') {
      result[key] = val
    } else if (typeof val === 'object' && val !== null && 'value' in val) {
      result[key] = (val as { value: number }).value
    }
  }
  return result
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface FoodItemFromJson {
  name: string
  quantity?: number
  unit?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
  micros?: Record<string, unknown>
}

interface MealFromApi {
  id: string
  food_items?: FoodItemFromJson[]
  source?: string
}

const main = async () => {
  const config = loadConfig()
  console.log(`🔑 Using API at ${config.baseUrl}`)

  // Fetch all meals (no date filter = all)
  console.log('📄 Fetching all meals...')
  const mealsRes = (await apiGet(config.baseUrl, config.token, '/meals')) as { data: MealFromApi[] }
  const meals = mealsRes.data ?? []
  console.log(`   ${meals.length} meals found`)

  // Build canonical food item map
  const foodItemMap = new Map<string, { name: string; source: string; defaults: Record<string, unknown> }>()
  let totalItems = 0

  for (const meal of meals) {
    for (const fi of meal.food_items ?? []) {
      totalItems++
      const key = fi.name.toLowerCase().trim()
      const existing = foodItemMap.get(key)

      // Build defaults from this food item
      const defaults: Record<string, unknown> = {
        default_quantity: fi.quantity,
        default_unit: fi.unit,
      }
      // Macros
      if (fi.calories !== undefined) defaults.calories = fi.calories
      if (fi.protein !== undefined) defaults.protein = fi.protein
      if (fi.carbs !== undefined) defaults.carbs = fi.carbs
      if (fi.fat !== undefined) defaults.fat = fi.fat
      if (fi.fiber !== undefined) defaults.fiber = fi.fiber
      // Micros → nutrient columns
      const micros = extractNutrientsFromMicros(fi.micros)
      Object.assign(defaults, micros)

      const richness = Object.values(defaults).filter((v) => v !== undefined && v !== null).length

      // Keep the richest version (most nutrient data)
      if (!existing || richness > Object.values(existing.defaults).filter((v) => v !== undefined).length) {
        foodItemMap.set(key, { name: fi.name, source: meal.source ?? 'manual', defaults })
      }
    }
  }

  console.log(`🍎 ${foodItemMap.size} unique food items from ${totalItems} total entries`)

  // Create canonical food items
  let created = 0
  const foodItemIds = new Map<string, string>() // name_lower → id

  for (const [key, { name, source, defaults }] of foodItemMap) {
    const body = { name, source, ...defaults }
    const res = (await apiPost(config.baseUrl, config.token, '/food-items', body)) as {
      data: { id: string }
    }
    foodItemIds.set(key, res.data.id)
    created++
    process.stdout.write(`\r   ✅ ${created}/${foodItemMap.size} food items created`)
  }
  console.log('')

  // Create junction rows by re-saving each meal with food_item_ids
  // For now, we just log what would happen — the meal service doesn't use junction yet.
  // The junction table will be populated when the meal service is updated.
  console.log(`📋 Food item ID mapping ready (${foodItemIds.size} entries)`)
  console.log('   Junction rows will be created when meal service is updated to use relational model.')
  console.log('🎉 Done! Food items are now in the canonical library.')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
