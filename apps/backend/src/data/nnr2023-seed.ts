/**
 * Nordic Nutrition Recommendations 2023 — adult reference range seed.
 *
 * Hand-curated single-tier ranges for ~30 key nutrients, used to seed the
 * central `shared_nutrient_recommendations` table. Values target a generic
 * adult and bridge male/female recommendations (low end ≈ female RDA, high
 * end ≈ tolerable upper intake or male RDA where sensible). Per-age/sex
 * tiering is deferred — the per-user override table lets people dial values
 * to their own NNR tier when it matters.
 *
 * Sources:
 *   - Nordic Nutrition Recommendations 2023 (NNR2023), nordicnutrition.org
 *   - Swedish Food Agency (Livsmedelsverket) translation of the NNR
 *
 * Units match `NUTRIENT_FIELDS` in @aurboda/api-spec exactly. Nutrients with
 * no clean range (calories — varies with size/activity, individual amino
 * acids, fatty-acid breakdowns, oxalate/phytate/ash) are omitted; users can
 * add an override if they care.
 */

export interface Nnr2023Entry {
  nutrient_name: string
  recommended_low: number | null
  recommended_high: number | null
  unit: string
  notes?: string
}

export const NNR2023_SOURCE_LABEL = 'NNR2023'
export const NNR2023_SOURCE_VERSION = '2023'

export const nnr2023Seed: Nnr2023Entry[] = [
  // Macros — based on a 2000 kcal reference diet
  { nutrient_name: 'protein', recommended_low: 50, recommended_high: 100, unit: 'g' },
  {
    nutrient_name: 'carbs',
    recommended_low: 225,
    recommended_high: 300,
    unit: 'g',
    notes: '45–60% of 2000 kcal',
  },
  {
    nutrient_name: 'fat',
    recommended_low: 55,
    recommended_high: 90,
    unit: 'g',
    notes: '25–40% of 2000 kcal',
  },
  { nutrient_name: 'fiber', recommended_low: 25, recommended_high: 35, unit: 'g' },
  {
    nutrient_name: 'saturated_fat',
    recommended_low: null,
    recommended_high: 22,
    unit: 'g',
    notes: '<10% of energy',
  },
  {
    nutrient_name: 'added_sugars',
    recommended_low: null,
    recommended_high: 50,
    unit: 'g',
    notes: '<10% of energy',
  },
  { nutrient_name: 'salt', recommended_low: null, recommended_high: 6, unit: 'g' },
  { nutrient_name: 'sodium', recommended_low: 1500, recommended_high: 2300, unit: 'mg' },
  {
    nutrient_name: 'water',
    recommended_low: 2000,
    recommended_high: 2700,
    unit: 'g',
    notes: 'Total fluid intake (food + drink)',
  },
  {
    nutrient_name: 'alcohol',
    recommended_low: null,
    recommended_high: 0,
    unit: 'g',
    notes: 'NNR: as low as possible',
  },
  { nutrient_name: 'cholesterol', recommended_low: null, recommended_high: 300, unit: 'mg' },

  // Vitamins
  { nutrient_name: 'vitamin_a', recommended_low: 700, recommended_high: 900, unit: 'µg' },
  { nutrient_name: 'vitamin_c', recommended_low: 75, recommended_high: 110, unit: 'mg' },
  {
    nutrient_name: 'vitamin_d',
    recommended_low: 10,
    recommended_high: 100,
    unit: 'µg',
    notes: 'Upper limit is the tolerable upper intake',
  },
  { nutrient_name: 'vitamin_e', recommended_low: 8, recommended_high: 10, unit: 'mg' },
  { nutrient_name: 'vitamin_k', recommended_low: 65, recommended_high: 80, unit: 'µg' },
  { nutrient_name: 'b1_thiamine', recommended_low: 1.0, recommended_high: 1.4, unit: 'mg' },
  { nutrient_name: 'b2_riboflavin', recommended_low: 1.3, recommended_high: 1.7, unit: 'mg' },
  { nutrient_name: 'niacin_equivalents', recommended_low: 14, recommended_high: 18, unit: 'mg' },
  { nutrient_name: 'b5_pantothenic_acid', recommended_low: 5, recommended_high: null, unit: 'mg' },
  { nutrient_name: 'b6_pyridoxine', recommended_low: 1.3, recommended_high: 1.7, unit: 'mg' },
  { nutrient_name: 'b12_cobalamin', recommended_low: 2.0, recommended_high: null, unit: 'µg' },
  { nutrient_name: 'folate', recommended_low: 330, recommended_high: 400, unit: 'µg' },

  // Minerals
  { nutrient_name: 'calcium', recommended_low: 800, recommended_high: 1000, unit: 'mg' },
  { nutrient_name: 'iron', recommended_low: 9, recommended_high: 15, unit: 'mg' },
  { nutrient_name: 'magnesium', recommended_low: 280, recommended_high: 350, unit: 'mg' },
  { nutrient_name: 'phosphorus', recommended_low: 600, recommended_high: null, unit: 'mg' },
  { nutrient_name: 'potassium', recommended_low: 3500, recommended_high: null, unit: 'mg' },
  { nutrient_name: 'selenium', recommended_low: 60, recommended_high: 75, unit: 'µg' },
  { nutrient_name: 'zinc', recommended_low: 7, recommended_high: 10, unit: 'mg' },
  { nutrient_name: 'iodine', recommended_low: 150, recommended_high: null, unit: 'µg' },
  { nutrient_name: 'copper', recommended_low: 0.9, recommended_high: null, unit: 'mg' },
  { nutrient_name: 'manganese', recommended_low: 2, recommended_high: 3, unit: 'mg' },
  { nutrient_name: 'chromium', recommended_low: 35, recommended_high: null, unit: 'µg' },
]
