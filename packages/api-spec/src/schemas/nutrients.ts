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

  // Vitamins
  { category: 'vitamin', label: 'Vitamin A', name: 'vitamin_a', unit: 'µg' },
  { category: 'vitamin', label: 'Retinol', name: 'retinol', unit: 'µg' },
  { category: 'vitamin', label: 'Beta-Carotene', name: 'beta_carotene', unit: 'µg' },
  { category: 'vitamin', label: 'Vitamin C', name: 'vitamin_c', unit: 'mg' },
  { category: 'vitamin', label: 'Vitamin D', name: 'vitamin_d', unit: 'µg' },
  { category: 'vitamin', label: 'Vitamin E', name: 'vitamin_e', unit: 'mg' },
  { category: 'vitamin', label: 'Vitamin K', name: 'vitamin_k', unit: 'µg' },
  { category: 'vitamin', label: 'B1 (Thiamine)', name: 'b1_thiamine', unit: 'mg' },
  { category: 'vitamin', label: 'B2 (Riboflavin)', name: 'b2_riboflavin', unit: 'mg' },
  { category: 'vitamin', label: 'B3 (Niacin)', name: 'b3_niacin', unit: 'mg' },
  { category: 'vitamin', label: 'B5 (Pantothenic Acid)', name: 'b5_pantothenic_acid', unit: 'mg' },
  { category: 'vitamin', label: 'B6 (Pyridoxine)', name: 'b6_pyridoxine', unit: 'mg' },
  { category: 'vitamin', label: 'B12 (Cobalamin)', name: 'b12_cobalamin', unit: 'µg' },
  { category: 'vitamin', label: 'Folate', name: 'folate', unit: 'µg' },

  // Minerals
  { category: 'mineral', label: 'Calcium', name: 'calcium', unit: 'mg' },
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
