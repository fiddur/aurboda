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

import { NUTRIENT_FIELDS } from '@aurboda/api-spec'

import {
  clearUserNutrientRecommendation as dbClearUserNutrientRecommendation,
  getUserNutrientRecommendation as dbGetUserNutrientRecommendation,
  listUserNutrientRecommendations as dbListUserNutrientRecommendations,
  type UserNutrientRecommendationInput,
  type UserNutrientRecommendationRow,
  upsertUserNutrientRecommendation as dbUpsertUserNutrientRecommendation,
} from '../db/user-nutrient-recommendations.ts'
import { getCentralDb } from './central-db.ts'

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

/**
 * Resolve the unit for a nutrient name. Prefer the central row's stored unit,
 * fall back to the api-spec NUTRIENT_FIELDS table so a user override on a
 * nutrient that has no central default still surfaces the right unit instead
 * of an empty string.
 */
const unitFor = (name: string, centralRow: CentralRow | undefined): string =>
  centralRow?.unit ?? NUTRIENT_UNIT_BY_NAME.get(name) ?? ''

const NUTRIENT_UNIT_BY_NAME = new Map<string, string>(NUTRIENT_FIELDS.map((f) => [f.name, f.unit]))

const mergeOne = (
  name: string,
  centralRow: CentralRow | undefined,
  userRow: UserNutrientRecommendationRow | undefined,
): NutrientRecommendation | null => {
  if (userRow) {
    // Suppression: user wrote NULL/NULL → no effective range.
    if (userRow.recommended_low === null && userRow.recommended_high === null) return null
    return {
      nutrient_name: name,
      recommended_low: userRow.recommended_low,
      recommended_high: userRow.recommended_high,
      unit: unitFor(name, centralRow),
      source: 'user',
      source_label: centralRow ? buildCentralLabel(centralRow) : null,
    }
  }
  if (centralRow) {
    return {
      nutrient_name: name,
      recommended_low: centralRow.recommended_low,
      recommended_high: centralRow.recommended_high,
      unit: centralRow.unit,
      source: 'central',
      source_label: buildCentralLabel(centralRow),
    }
  }
  return null
}

export const getEffectiveRecommendations = async (user: string): Promise<NutrientRecommendation[]> => {
  const central = await getCentralDb().getAllSharedNutrientRecommendations()
  const overrides = await dbListUserNutrientRecommendations(user)
  const overrideByName = new Map(overrides.map((row) => [row.nutrient_name, row]))
  const centralByName = new Map(central.map((row) => [row.nutrient_name, row]))
  const allNames = new Set<string>([...centralByName.keys(), ...overrideByName.keys()])

  const out: NutrientRecommendation[] = []
  for (const name of allNames) {
    const merged = mergeOne(name, centralByName.get(name), overrideByName.get(name))
    if (merged) out.push(merged)
  }
  out.sort((a, b) => a.nutrient_name.localeCompare(b.nutrient_name))
  return out
}

/**
 * Look up the merged effective recommendation for a single nutrient with two
 * targeted queries, used after upsert/clear to return the new state without
 * a full table scan.
 */
export const getEffectiveRecommendation = async (
  user: string,
  nutrientName: string,
): Promise<NutrientRecommendation | null> => {
  const [centralRow, userRow] = await Promise.all([
    getCentralDb().getSharedNutrientRecommendation(nutrientName),
    dbGetUserNutrientRecommendation(user, nutrientName),
  ])
  return mergeOne(nutrientName, centralRow ?? undefined, userRow ?? undefined)
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
