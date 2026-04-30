/**
 * Sensitivity flag CRUD + food-item assignment schemas.
 *
 * Flags are user-defined labels (dairy, gluten, alcohol, …). The junction
 * table `food_item_sensitivities` links a flag to a food item via a soft
 * pointer on `food_item_id` so users can attach flags to central-library
 * items too.
 */
import { z } from 'zod'

import { baseResponseSchema, createDataArrayResponseSchema, createDataResponseSchema } from './common.ts'

export const sensitivityFlagSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(100),
    color: z.string().nullable().optional().meta({ description: 'Optional CSS color for chip rendering.' }),
    icon: z.string().nullable().optional(),
    sort_order: z.number().int().default(0),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .meta({ description: 'A user-defined sensitivity flag', id: 'SensitivityFlag' })

export type SensitivityFlag = z.infer<typeof sensitivityFlagSchema>

export const addSensitivityFlagBodySchema = z
  .object({
    name: z.string().min(1).max(100),
    color: z.string().optional(),
    icon: z.string().optional(),
    sort_order: z.number().int().optional(),
  })
  .meta({ description: 'Create a new sensitivity flag', id: 'AddSensitivityFlagBody' })

export type AddSensitivityFlagBody = z.infer<typeof addSensitivityFlagBodySchema>

export const updateSensitivityFlagBodySchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    color: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
    sort_order: z.number().int().optional(),
  })
  .meta({ description: 'Update a sensitivity flag', id: 'UpdateSensitivityFlagBody' })

export type UpdateSensitivityFlagBody = z.infer<typeof updateSensitivityFlagBodySchema>

export const setFoodItemSensitivitiesBodySchema = z
  .object({
    sensitivity_flag_ids: z.array(z.string().uuid()).meta({
      description:
        'Full list of flag IDs to assign to this food item — replace semantics. Pass `[]` to clear.',
    }),
  })
  .meta({
    description: 'Replace the sensitivity flags assigned to a food item',
    id: 'SetFoodItemSensitivitiesBody',
  })

export type SetFoodItemSensitivitiesBody = z.infer<typeof setFoodItemSensitivitiesBodySchema>

export const sensitivityFlagResponseSchema = createDataResponseSchema(sensitivityFlagSchema).meta({
  id: 'SensitivityFlagResponse',
})
export type SensitivityFlagResponse = z.infer<typeof sensitivityFlagResponseSchema>

export const sensitivityFlagsResponseSchema = createDataArrayResponseSchema(sensitivityFlagSchema).meta({
  id: 'SensitivityFlagsResponse',
})
export type SensitivityFlagsResponse = z.infer<typeof sensitivityFlagsResponseSchema>

export const deleteSensitivityFlagResponseSchema = baseResponseSchema.meta({
  id: 'DeleteSensitivityFlagResponse',
})
export type DeleteSensitivityFlagResponse = z.infer<typeof deleteSensitivityFlagResponseSchema>
