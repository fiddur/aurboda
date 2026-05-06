/**
 * Shared nutrient field definitions.
 *
 * Used by food_items and meal_food_items tables, API schemas, and TypeScript types.
 * Units are fixed per column — no per-value unit storage needed.
 *
 * Sources: Cronometer export fields + Livsmedelsverket (Swedish Food Agency) API.
 */

import { z } from 'zod'

export interface NutrientFieldDef {
  /** Column/field name (snake_case). */
  name: string
  /** Display label. */
  label: string
  /** Fixed unit for this nutrient. */
  unit: string
  /** Category for grouping in UI. */
  category: 'macro' | 'extended_macro' | 'fat_breakdown' | 'vitamin' | 'mineral' | 'amino_acid' | 'other'
}

/**
 * All nutrient fields, in display order.
 * This is the single source of truth for nutrient columns across the system.
 */
export const NUTRIENT_FIELDS = [
  // Macros (also on meals table directly)
  { category: 'macro', label: 'Calories', name: 'calories', unit: 'kcal' },
  { category: 'macro', label: 'Protein', name: 'protein', unit: 'g' },
  { category: 'macro', label: 'Carbs', name: 'carbs', unit: 'g' },
  { category: 'macro', label: 'Fat', name: 'fat', unit: 'g' },
  { category: 'macro', label: 'Fiber', name: 'fiber', unit: 'g' },

  // Extended macros
  { category: 'extended_macro', label: 'Alcohol', name: 'alcohol', unit: 'g' },
  { category: 'extended_macro', label: 'Caffeine', name: 'caffeine', unit: 'mg' },
  { category: 'extended_macro', label: 'Water', name: 'water', unit: 'g' },
  { category: 'extended_macro', label: 'Net Carbs', name: 'net_carbs', unit: 'g' },
  { category: 'extended_macro', label: 'Starch', name: 'starch', unit: 'g' },
  { category: 'extended_macro', label: 'Sugars', name: 'sugars', unit: 'g' },
  { category: 'extended_macro', label: 'Added Sugars', name: 'added_sugars', unit: 'g' },
  { category: 'extended_macro', label: 'Free Sugars', name: 'free_sugars', unit: 'g' },
  { category: 'extended_macro', label: 'Sucrose', name: 'sucrose', unit: 'g' },
  { category: 'extended_macro', label: 'Monosaccharides', name: 'monosaccharides', unit: 'g' },
  { category: 'extended_macro', label: 'Disaccharides', name: 'disaccharides', unit: 'g' },
  { category: 'extended_macro', label: 'Whole Grain', name: 'whole_grain', unit: 'g' },
  { category: 'extended_macro', label: 'Cholesterol', name: 'cholesterol', unit: 'mg' },

  // Fat breakdown
  { category: 'fat_breakdown', label: 'Saturated Fat', name: 'saturated_fat', unit: 'g' },
  { category: 'fat_breakdown', label: 'Monounsaturated Fat', name: 'monounsaturated_fat', unit: 'g' },
  { category: 'fat_breakdown', label: 'Polyunsaturated Fat', name: 'polyunsaturated_fat', unit: 'g' },
  { category: 'fat_breakdown', label: 'Trans Fat', name: 'trans_fat', unit: 'g' },
  { category: 'fat_breakdown', label: 'Omega-3', name: 'omega_3', unit: 'g' },
  { category: 'fat_breakdown', label: 'Omega-6', name: 'omega_6', unit: 'g' },
  { category: 'fat_breakdown', label: 'ALA', name: 'ala', unit: 'g' },
  { category: 'fat_breakdown', label: 'DHA', name: 'dha', unit: 'g' },
  { category: 'fat_breakdown', label: 'EPA', name: 'epa', unit: 'g' },
  { category: 'fat_breakdown', label: 'DPA', name: 'dpa', unit: 'g' },
  { category: 'fat_breakdown', label: 'AA', name: 'aa', unit: 'g' },
  { category: 'fat_breakdown', label: 'LA', name: 'la', unit: 'g' },
  // Individual fatty acids (LSV)
  {
    category: 'fat_breakdown',
    label: 'Short-chain Fatty Acids (4-10:0)',
    name: 'short_chain_fatty_acids',
    unit: 'g',
  },
  { category: 'fat_breakdown', label: 'Lauric Acid (12:0)', name: 'lauric_acid', unit: 'g' },
  { category: 'fat_breakdown', label: 'Myristic Acid (14:0)', name: 'myristic_acid', unit: 'g' },
  { category: 'fat_breakdown', label: 'Palmitic Acid (16:0)', name: 'palmitic_acid', unit: 'g' },
  { category: 'fat_breakdown', label: 'Palmitoleic Acid (16:1)', name: 'palmitoleic_acid', unit: 'g' },
  { category: 'fat_breakdown', label: 'Stearic Acid (18:0)', name: 'stearic_acid', unit: 'g' },
  { category: 'fat_breakdown', label: 'Oleic Acid (18:1)', name: 'oleic_acid', unit: 'g' },
  { category: 'fat_breakdown', label: 'Arachidic Acid (20:0)', name: 'arachidic_acid', unit: 'g' },

  // Vitamins
  { category: 'vitamin', label: 'Vitamin A', name: 'vitamin_a', unit: 'µg' },
  { category: 'vitamin', label: 'Retinol', name: 'retinol', unit: 'µg' },
  { category: 'vitamin', label: 'Beta-Carotene', name: 'beta_carotene', unit: 'µg' },
  { category: 'vitamin', label: 'Vitamin C', name: 'vitamin_c', unit: 'mg' },
  { category: 'vitamin', label: 'Vitamin D', name: 'vitamin_d', unit: 'µg' },
  { category: 'vitamin', label: 'Vitamin D incl 25-OH-D3', name: 'vitamin_d_25oh', unit: 'µg' },
  { category: 'vitamin', label: 'Vitamin E', name: 'vitamin_e', unit: 'mg' },
  { category: 'vitamin', label: 'Vitamin K', name: 'vitamin_k', unit: 'µg' },
  { category: 'vitamin', label: 'B1 (Thiamine)', name: 'b1_thiamine', unit: 'mg' },
  { category: 'vitamin', label: 'B2 (Riboflavin)', name: 'b2_riboflavin', unit: 'mg' },
  { category: 'vitamin', label: 'B3 (Niacin)', name: 'b3_niacin', unit: 'mg' },
  { category: 'vitamin', label: 'Niacin Equivalents', name: 'niacin_equivalents', unit: 'mg' },
  { category: 'vitamin', label: 'B5 (Pantothenic Acid)', name: 'b5_pantothenic_acid', unit: 'mg' },
  { category: 'vitamin', label: 'B6 (Pyridoxine)', name: 'b6_pyridoxine', unit: 'mg' },
  { category: 'vitamin', label: 'B12 (Cobalamin)', name: 'b12_cobalamin', unit: 'µg' },
  { category: 'vitamin', label: 'Folate', name: 'folate', unit: 'µg' },

  // Minerals
  { category: 'mineral', label: 'Calcium', name: 'calcium', unit: 'mg' },
  { category: 'mineral', label: 'Chromium', name: 'chromium', unit: 'µg' },
  { category: 'mineral', label: 'Copper', name: 'copper', unit: 'mg' },
  { category: 'mineral', label: 'Iron', name: 'iron', unit: 'mg' },
  { category: 'mineral', label: 'Magnesium', name: 'magnesium', unit: 'mg' },
  { category: 'mineral', label: 'Manganese', name: 'manganese', unit: 'mg' },
  { category: 'mineral', label: 'Phosphorus', name: 'phosphorus', unit: 'mg' },
  { category: 'mineral', label: 'Potassium', name: 'potassium', unit: 'mg' },
  { category: 'mineral', label: 'Selenium', name: 'selenium', unit: 'µg' },
  { category: 'mineral', label: 'Sodium', name: 'sodium', unit: 'mg' },
  { category: 'mineral', label: 'Zinc', name: 'zinc', unit: 'mg' },
  { category: 'mineral', label: 'Iodine', name: 'iodine', unit: 'µg' },

  // Amino acids
  { category: 'amino_acid', label: 'Cystine', name: 'cystine', unit: 'g' },
  { category: 'amino_acid', label: 'Histidine', name: 'histidine', unit: 'g' },
  { category: 'amino_acid', label: 'Isoleucine', name: 'isoleucine', unit: 'g' },
  { category: 'amino_acid', label: 'Leucine', name: 'leucine', unit: 'g' },
  { category: 'amino_acid', label: 'Lysine', name: 'lysine', unit: 'g' },
  { category: 'amino_acid', label: 'Methionine', name: 'methionine', unit: 'g' },
  { category: 'amino_acid', label: 'Phenylalanine', name: 'phenylalanine', unit: 'g' },
  { category: 'amino_acid', label: 'Threonine', name: 'threonine', unit: 'g' },
  { category: 'amino_acid', label: 'Tryptophan', name: 'tryptophan', unit: 'g' },
  { category: 'amino_acid', label: 'Tyrosine', name: 'tyrosine', unit: 'g' },
  { category: 'amino_acid', label: 'Valine', name: 'valine', unit: 'g' },

  // Other
  { category: 'other', label: 'Oxalate', name: 'oxalate', unit: 'mg' },
  { category: 'other', label: 'Phytate', name: 'phytate', unit: 'mg' },
  { category: 'other', label: 'Ash', name: 'ash', unit: 'g' },
  { category: 'other', label: 'Salt', name: 'salt', unit: 'g' },
] as const satisfies readonly NutrientFieldDef[]

/** All nutrient field names. */
export const NUTRIENT_FIELD_NAMES = NUTRIENT_FIELDS.map((f) => f.name)

/** Macro field names ('calories' plus the four core macros). */
export const MACRO_FIELD_NAMES = NUTRIENT_FIELDS.filter((f) => f.category === 'macro').map((f) => f.name)

/** Macro field names excluding 'calories' — used to detect "more than just kcal". */
export const NON_CALORIE_MACRO_FIELD_NAMES = MACRO_FIELD_NAMES.filter((n) => n !== 'calories')

/**
 * Micronutrient field names — every nutrient field that is *not* in the
 * 'macro' category. Used by search ranking to prioritize food items with
 * richer nutrition data over bare kcal-only entries.
 */
export const MICRO_FIELD_NAMES = NUTRIENT_FIELDS.filter((f) => f.category !== 'macro').map((f) => f.name)

/**
 * Quality tier for ranking food items by how complete their nutrition data
 * is. Lower tier = better data. Used by food-item search to surface the
 * Livsmedelsverket reference data above bare kcal-only imports.
 *
 *   0 — has at least one micronutrient (vitamin/mineral/amino acid/...)
 *   1 — has at least one non-calorie macro (protein/carbs/fat/fiber)
 *   2 — has only calories
 *   3 — empty (no nutrient data at all)
 */
export const getFoodItemQualityTier = (item: Readonly<Record<string, unknown>>): 0 | 1 | 2 | 3 => {
  const hasValue = (n: string): boolean => {
    const v = item[n]
    return typeof v === 'number' && !Number.isNaN(v)
  }
  if (MICRO_FIELD_NAMES.some(hasValue)) return 0
  if (NON_CALORIE_MACRO_FIELD_NAMES.some(hasValue)) return 1
  if (hasValue('calories')) return 2
  return 3
}

/**
 * SQL fragment that resolves to a 0–3 integer quality tier for a row in
 * `food_items` or `shared_food_items`. Mirrors `getFoodItemQualityTier`
 * exactly so the JS-side merge in `FoodItemsService.search` can re-rank
 * results from both stores against the same tier scale.
 */
export const foodItemQualityTierSql = (): string => {
  const microExpr = MICRO_FIELD_NAMES.map((n) => `${n} IS NOT NULL`).join(' OR ')
  const macroExpr = NON_CALORIE_MACRO_FIELD_NAMES.map((n) => `${n} IS NOT NULL`).join(' OR ')
  return `CASE
    WHEN ${microExpr} THEN 0
    WHEN ${macroExpr} THEN 1
    WHEN calories IS NOT NULL THEN 2
    ELSE 3
  END`
}

/** Generate SQL column definitions for all nutrient fields. */
export const nutrientColumnsDDL = (): string =>
  NUTRIENT_FIELDS.map((f) => `      ${f.name.padEnd(24)} DOUBLE PRECISION`).join(',\n')

/**
 * Zod schema with all nutrient fields as optional numbers.
 * Used for food item and meal_food_item validation.
 *
 * The type assertion ensures TypeScript infers individual named fields
 * (e.g. `{ calories?: number; protein?: number; ... }`) instead of a
 * `Record<string, number | undefined>` index signature. Without this,
 * extending the schema with non-number fields (like FoodItemEntity.name)
 * would create an impossible type.
 */
type NutrientFieldName = (typeof NUTRIENT_FIELDS)[number]['name']
type NutrientSchemaShape = { [K in NutrientFieldName]: z.ZodOptional<z.ZodNumber> }

export const nutrientFieldsSchema = z.object(
  Object.fromEntries(
    NUTRIENT_FIELDS.map((f) => [
      f.name,
      z
        .number()
        .optional()
        .meta({ description: `${f.label} (${f.unit})` }),
    ]),
  ) as unknown as NutrientSchemaShape,
)

export type NutrientFields = z.infer<typeof nutrientFieldsSchema>
