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
  getSharedNutrientRecommendation: (nutrientName: string) => Promise<SharedNutrientRecommendationRow | null>
}

const SELECT_COLUMNS =
  'nutrient_name, recommended_low, recommended_high, unit, source, source_version, notes, updated_at'

export const createSharedNutrientRecommendationsApi = (
  getClient: () => Promise<pg.Client>,
): SharedNutrientRecommendationsApi => ({
  getAllSharedNutrientRecommendations: async () => {
    const client = await getClient()
    const result = await client.query(`SELECT ${SELECT_COLUMNS} FROM shared_nutrient_recommendations`)
    return result.rows.map(mapRow)
  },
  getSharedNutrientRecommendation: async (nutrientName) => {
    const client = await getClient()
    const result = await client.query(
      `SELECT ${SELECT_COLUMNS} FROM shared_nutrient_recommendations WHERE nutrient_name = $1`,
      [nutrientName],
    )
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  },
})

/**
 * Stable advisory-lock key for the NNR2023 seed. The number itself is
 * arbitrary — what matters is that all backend instances use the same value
 * so concurrent boots serialize on the same lock. Picked from a hash of the
 * seed name; recompute only if the seed identity changes.
 */
const NNR2023_SEED_ADVISORY_LOCK_KEY = 7702_320_023n // mnemonic: NNR-2023

/**
 * Seed/upsert the NNR2023 defaults. Safe to run on every server boot — the
 * UPSERT no-ops on rows whose (low, high, unit, source_version, notes) match
 * the seed, so a maintainer hand-fixing a value in the central DB will see
 * it overwritten only if it actually drifted from this file. The seed file
 * is the source of truth.
 *
 * Note: this is upsert-only; nutrients **removed** from `nnr2023Seed` linger
 * in `shared_nutrient_recommendations` until manually deleted. The override
 * layer can suppress them per-user, and a future curated-seed bump can do a
 * one-shot delete pass — keeping it deliberate for now to avoid surprising
 * users whose UI suddenly drops a familiar bar.
 *
 * Wrapped in a transaction with `pg_advisory_xact_lock` so multiple backend
 * instances starting in parallel serialize through one writer instead of
 * each issuing the same ~30 INSERTs.
 */
export const seedSharedNutrientRecommendations = async (client: pg.Client): Promise<void> => {
  await client.query('BEGIN')
  try {
    await client.query('SELECT pg_advisory_xact_lock($1)', [NNR2023_SEED_ADVISORY_LOCK_KEY.toString()])
    for (const entry of nnr2023Seed) {
      if (entry.recommended_low === null && entry.recommended_high === null) {
        // The table CHECK constraint forbids all-null rows; if this hits, a
        // typo in the seed file would silently no-op. Fail loudly instead.
        throw new Error(
          `nnr2023Seed entry "${entry.nutrient_name}" has no bounds — at least one of recommended_low / recommended_high is required`,
        )
      }
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
           updated_at       = NOW()
         WHERE shared_nutrient_recommendations.recommended_low  IS DISTINCT FROM EXCLUDED.recommended_low
            OR shared_nutrient_recommendations.recommended_high IS DISTINCT FROM EXCLUDED.recommended_high
            OR shared_nutrient_recommendations.unit             IS DISTINCT FROM EXCLUDED.unit
            OR shared_nutrient_recommendations.source           IS DISTINCT FROM EXCLUDED.source
            OR shared_nutrient_recommendations.source_version   IS DISTINCT FROM EXCLUDED.source_version
            OR shared_nutrient_recommendations.notes            IS DISTINCT FROM EXCLUDED.notes`,
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
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  }
}
