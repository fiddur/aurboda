/**
 * Central nutrient recommendation defaults (NNR2023 seed).
 *
 * Lives in the central database — every user starts from the same curated
 * Nordic Nutrition Recommendations baseline. Per-user customization happens
 * via `user_nutrient_recommendations` in each user's own DB; this module
 * only exposes the read API and seeding for the central layer.
 */

import type pg from 'pg'

import { nnr2023Seed, NNR2023_SOURCE_LABEL, NNR2023_SOURCE_VERSION } from '../data/nnr2023-seed.ts'

export interface SharedNutrientRecommendationRow {
  nutrient_name: string
  recommended_low: number | null
  recommended_high: number | null
  unit: string
  source: string
  source_version: string | null
  notes: string | null
  updated_at: Date
}

export const CREATE_SHARED_NUTRIENT_RECOMMENDATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS shared_nutrient_recommendations (
    nutrient_name      TEXT PRIMARY KEY,
    recommended_low    DOUBLE PRECISION,
    recommended_high   DOUBLE PRECISION,
    unit               TEXT NOT NULL,
    source             TEXT NOT NULL,
    source_version     TEXT,
    notes              TEXT,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT shared_nutrient_rec_has_bound CHECK (
      recommended_low IS NOT NULL OR recommended_high IS NOT NULL
    )
  )
`

const mapRow = (row: Record<string, unknown>): SharedNutrientRecommendationRow => ({
  nutrient_name: row.nutrient_name as string,
  recommended_low: row.recommended_low as number | null,
  recommended_high: row.recommended_high as number | null,
  unit: row.unit as string,
  source: row.source as string,
  source_version: (row.source_version as string | null) ?? null,
  notes: (row.notes as string | null) ?? null,
  updated_at: row.updated_at as Date,
})

export interface SharedNutrientRecommendationsApi {
  getAllSharedNutrientRecommendations: () => Promise<SharedNutrientRecommendationRow[]>
}

export const createSharedNutrientRecommendationsApi = (
  getClient: () => Promise<pg.Client>,
): SharedNutrientRecommendationsApi => ({
  getAllSharedNutrientRecommendations: async () => {
    const client = await getClient()
    const result = await client.query(
      `SELECT nutrient_name, recommended_low, recommended_high, unit, source, source_version, notes, updated_at
         FROM shared_nutrient_recommendations`,
    )
    return result.rows.map(mapRow)
  },
})

/**
 * Seed/upsert the NNR2023 defaults. Safe to run on every server boot —
 * existing rows are refreshed only if their (low, high, unit, source_version,
 * notes) drifted from the seed, so manual edits a maintainer might make in
 * the central DB to fix a value without changing the seed file get
 * overwritten on next boot. That is intentional: the seed file is the source
 * of truth.
 */
export const seedSharedNutrientRecommendations = async (client: pg.Client): Promise<void> => {
  for (const entry of nnr2023Seed) {
    if (entry.recommended_low === null && entry.recommended_high === null) continue
    await client.query(
      `INSERT INTO shared_nutrient_recommendations
         (nutrient_name, recommended_low, recommended_high, unit, source, source_version, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (nutrient_name) DO UPDATE SET
         recommended_low  = EXCLUDED.recommended_low,
         recommended_high = EXCLUDED.recommended_high,
         unit             = EXCLUDED.unit,
         source           = EXCLUDED.source,
         source_version   = EXCLUDED.source_version,
         notes            = EXCLUDED.notes,
         updated_at       = NOW()`,
      [
        entry.nutrient_name,
        entry.recommended_low,
        entry.recommended_high,
        entry.unit,
        NNR2023_SOURCE_LABEL,
        NNR2023_SOURCE_VERSION,
        entry.notes ?? null,
      ],
    )
  }
}
