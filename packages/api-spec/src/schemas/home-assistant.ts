import { z } from 'zod'

import { createDataArrayResponseSchema } from './common.ts'

export const homeAssistantEntitySchema = z
  .object({
    entity_id: z
      .string()
      .meta({ description: 'Home Assistant entity id', example: 'device_tracker.pixel_8' }),
    name: z.string().nullable().meta({ description: "The entity's friendly name, if any" }),
    state: z
      .string()
      .meta({ description: 'Current state: the zone name, home or not_home', example: 'home' }),
  })
  .meta({
    id: 'HomeAssistantEntity',
    description: 'A Home Assistant person or device_tracker entity that currently carries coordinates',
  })

export type HomeAssistantEntity = z.infer<typeof homeAssistantEntitySchema>

export const homeAssistantEntitiesResponseSchema = createDataArrayResponseSchema(
  homeAssistantEntitySchema,
).meta({
  id: 'HomeAssistantEntitiesResponse',
})

export type HomeAssistantEntitiesResponse = z.infer<typeof homeAssistantEntitiesResponseSchema>
