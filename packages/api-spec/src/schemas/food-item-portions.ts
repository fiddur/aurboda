/**
 * Food item portion schemas — alternate *units* for a food item beyond its
 * "base" (default_quantity/default_unit). A portion is a named unit plus its
 * conversion to the base unit: "1 label_unit = base_equivalent base_units".
 *
 * When logging, the user enters a quantity in the chosen unit; nutrients
 * scale as `entered_quantity × base_equivalent / default_quantity`. (For the
 * base unit itself, base_equivalent is implicitly 1.)
 */

import { z } from 'zod'

import { baseResponseSchema, createDataArrayResponseSchema, createDataResponseSchema } from './common.ts'

export const foodItemPortionSchema = z
  .object({
    id: z.string().uuid().meta({ description: 'Portion id' }),
    food_item_id: z.string().uuid().meta({
      description:
        'Food item this portion belongs to. Soft pointer — may target a per-user or a central shared food item.',
    }),
    label_unit: z.string().min(1).max(100).meta({
      description: 'Unit name (e.g. "wrap", "glas", "ruta"). Shown bare — never prefixed with a number.',
    }),
    base_equivalent: z.number().positive().meta({
      description:
        'How many of the food\'s base unit ONE of this unit equals. Example: a 100 g base with "1 ruta = 3.4 g" stores 3.4. To scale nutrients when logging Q of this unit: nutrient_value × Q × base_equivalent / default_quantity.',
    }),
    // sort_order, created_at, updated_at are always populated by the DB and
    // emitted by the response serializer — clients can rely on them.
    sort_order: z.number().int().meta({ description: 'Display order' }),
    created_at: z.string().meta({ description: 'Creation timestamp' }),
    updated_at: z.string().meta({ description: 'Last update timestamp' }),
  })
  .meta({ description: 'A named unit (with base-unit conversion) for a food item', id: 'FoodItemPortion' })

export type FoodItemPortion = z.infer<typeof foodItemPortionSchema>

export const addFoodItemPortionBodySchema = z
  .object({
    label_unit: z.string().min(1).max(100),
    base_equivalent: z.number().positive(),
    sort_order: z.number().int().optional(),
  })
  .meta({ description: 'Create a portion (unit) on a food item', id: 'AddFoodItemPortionBody' })

export type AddFoodItemPortionBody = z.infer<typeof addFoodItemPortionBodySchema>

export const updateFoodItemPortionBodySchema = z
  .object({
    label_unit: z.string().min(1).max(100).optional(),
    base_equivalent: z.number().positive().optional(),
    sort_order: z.number().int().optional(),
  })
  .meta({
    description: 'Update a portion — only provided fields are changed',
    id: 'UpdateFoodItemPortionBody',
  })

export type UpdateFoodItemPortionBody = z.infer<typeof updateFoodItemPortionBodySchema>

export const foodItemPortionResponseSchema = createDataResponseSchema(foodItemPortionSchema).meta({
  id: 'FoodItemPortionResponse',
})
export type FoodItemPortionResponse = z.infer<typeof foodItemPortionResponseSchema>

export const foodItemPortionsResponseSchema = createDataArrayResponseSchema(foodItemPortionSchema).meta({
  id: 'FoodItemPortionsResponse',
})
export type FoodItemPortionsResponse = z.infer<typeof foodItemPortionsResponseSchema>

export const deleteFoodItemPortionResponseSchema = baseResponseSchema.meta({
  id: 'DeleteFoodItemPortionResponse',
})
export type DeleteFoodItemPortionResponse = z.infer<typeof deleteFoodItemPortionResponseSchema>

/**
 * Body for `PUT /food-items/:id/default-portion` — set or clear the default
 * logging amount: which unit to preselect (`portion_id`, null = the base
 * unit) and how much (`quantity`). E.g. base 1 wrap but default "2 wrap":
 * `{ portion_id: null, quantity: 2 }`. `{ portion_id: null, quantity: null }`
 * clears the override (prefill falls back to the base quantity).
 */
export const setDefaultFoodItemPortionBodySchema = z
  .object({
    portion_id: z
      .string()
      .uuid()
      .nullable()
      .meta({ description: 'Portion (unit) id to preselect, or null for the base unit' }),
    quantity: z.number().positive().nullable().optional().meta({
      description:
        'Default quantity to prefill, or null to fall back to the base quantity. Omitting it is treated as null (back-compat for callers that send only portion_id).',
    }),
  })
  .meta({
    description: 'Set or clear the default logging amount (unit + quantity) for a food item',
    id: 'SetDefaultFoodItemPortionBody',
  })

export type SetDefaultFoodItemPortionBody = z.infer<typeof setDefaultFoodItemPortionBodySchema>
