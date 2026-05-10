/**
 * Effective per-user nutrient recommendations.
 *
 * Reads central NNR2023 defaults and per-user override rows, merges them
 * per nutrient, and produces the list the API and MCP layers return.
 *
 * Merge rules (per nutrient_name):
 *   - User row exists  → user values (any explicit NULL = "suppress this
 *                        nutrient's default", which we surface by dropping
 *                        the entry entirely if both bounds are null).
 *   - Else central     → central values, source = 'central'.
 *   - Else             → not present.
 */

import type { NutrientRecommendation } from '@aurboda/api-spec'

import {
  clearUserNutrientRecommendation as dbClearUserNutrientRecommendation,
  listUserNutrientRecommendations as dbListUserNutrientRecommendations,
  type UserNutrientRecommendationInput,
  upsertUserNutrientRecommendation as dbUpsertUserNutrientRecommendation,
} from '../db/user-nutrient-recommendations.ts'
import { getCentralDb } from './central-db.ts'

const NUTRIENT_UNIT_FALLBACK = ''

interface CentralRow {
  nutrient_name: string
  recommended_low: number | null
  recommended_high: number | null
  unit: string
  source: string
  source_version: string | null
}

const buildCentralLabel = (row: CentralRow): string =>
  row.source_version ? `${row.source} ${row.source_version}` : row.source

export const getEffectiveRecommendations = async (user: string): Promise<NutrientRecommendation[]> => {
  const central = await getCentralDb().getAllSharedNutrientRecommendations()
  const overrides = await dbListUserNutrientRecommendations(user)
  const overrideByName = new Map(overrides.map((row) => [row.nutrient_name, row]))
  const centralByName = new Map(central.map((row) => [row.nutrient_name, row]))
  const allNames = new Set<string>([...centralByName.keys(), ...overrideByName.keys()])

  const out: NutrientRecommendation[] = []
  for (const name of allNames) {
    const centralRow = centralByName.get(name)
    const userRow = overrideByName.get(name)
    if (userRow) {
      // Suppression: user wrote NULL/NULL → drop the entry so the UI shows
      // the value without a recommended range.
      if (userRow.recommended_low === null && userRow.recommended_high === null) continue
      out.push({
        nutrient_name: name,
        recommended_low: userRow.recommended_low,
        recommended_high: userRow.recommended_high,
        unit: centralRow?.unit ?? NUTRIENT_UNIT_FALLBACK,
        source: 'user',
        source_label: centralRow ? buildCentralLabel(centralRow) : null,
      })
      continue
    }
    if (centralRow) {
      out.push({
        nutrient_name: name,
        recommended_low: centralRow.recommended_low,
        recommended_high: centralRow.recommended_high,
        unit: centralRow.unit,
        source: 'central',
        source_label: buildCentralLabel(centralRow),
      })
    }
  }

  out.sort((a, b) => a.nutrient_name.localeCompare(b.nutrient_name))
  return out
}

/**
 * Look up just one nutrient — used after upsert to return the merged record
 * back to the caller so the client can render the new effective state.
 */
export const getEffectiveRecommendation = async (
  user: string,
  nutrientName: string,
): Promise<NutrientRecommendation | null> => {
  const all = await getEffectiveRecommendations(user)
  return all.find((r) => r.nutrient_name === nutrientName) ?? null
}

export const setUserNutrientRecommendation = async (
  user: string,
  nutrientName: string,
  input: UserNutrientRecommendationInput,
): Promise<NutrientRecommendation | null> => {
  await dbUpsertUserNutrientRecommendation(user, nutrientName, input)
  return getEffectiveRecommendation(user, nutrientName)
}

export const clearUserNutrientRecommendation = async (
  user: string,
  nutrientName: string,
): Promise<{ cleared: boolean; effective: NutrientRecommendation | null }> => {
  const cleared = await dbClearUserNutrientRecommendation(user, nutrientName)
  const effective = await getEffectiveRecommendation(user, nutrientName)
  return { cleared, effective }
}
