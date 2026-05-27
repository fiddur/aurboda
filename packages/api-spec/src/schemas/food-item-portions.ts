/**
 * Food item portion schemas — additional sizings for a food item beyond its
 * "base" (default_quantity/default_unit). Each portion expresses an
 * equivalence "label_quantity label_unit = base_equivalent base_units" so the
 * meal logger can scale nutrients without unit-conversion guesswork.
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
    label_quantity: z.number().positive().meta({
      description: 'Display quantity for the portion (e.g. 2 in "2 wrap", 1 in "1 glas").',
    }),
    label_unit: z.string().min(1).max(100).meta({
      description: 'Display unit for the portion (e.g. "wrap", "glas", "ruta").',
    }),
    base_equivalent: z.number().positive().meta({
      description:
        'How much of the food item\'s base unit this whole portion entry equals. Example: a 100 g base with a "1 ruta = 3.4 g" portion stores 3.4 here.',
    }),
    sort_order: z.number().int().optional().meta({ description: 'Display order' }),
    created_at: z.string().optional().meta({ description: 'Creation timestamp' }),
    updated_at: z.string().optional().meta({ description: 'Last update timestamp' }),
  })
  .meta({ description: 'A named portion sizing for a food item', id: 'FoodItemPortion' })

export type FoodItemPortion = z.infer<typeof foodItemPortionSchema>

export const addFoodItemPortionBodySchema = z
  .object({
    label_quantity: z.number().positive(),
    label_unit: z.string().min(1).max(100),
    base_equivalent: z.number().positive(),
    sort_order: z.number().int().optional(),
  })
  .meta({ description: 'Create a portion on a food item', id: 'AddFoodItemPortionBody' })

export type AddFoodItemPortionBody = z.infer<typeof addFoodItemPortionBodySchema>

export const updateFoodItemPortionBodySchema = z
  .object({
    label_quantity: z.number().positive().optional(),
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
