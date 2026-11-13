import { z } from 'zod'

import { createDataResponseSchema, dataFieldPathSchema, iso8601DateTimeSchema } from './common.ts'
import { dataFieldCatalogSchema } from './data-schema.ts'
import { exerciseCatalogEntrySchema, exerciseCatalogKeySchema } from './exercise-catalog.ts'

export const itemValueIdentityStates = ['user', 'catalog', 'dismissed', 'unmapped'] as const

export const itemValueIdentityStateSchema = z.enum(itemValueIdentityStates).meta({
  description:
    'How a logged name resolves to the catalogue: `user` the user mapped it to an entry, `catalog` it equals a catalogue name or alias, `dismissed` the user said it is not in the catalogue, `unmapped` none of these',
  id: 'ItemValueIdentityState',
})

export type ItemValueIdentityState = z.infer<typeof itemValueIdentityStateSchema>

const catalogFieldPathSchema = dataFieldPathSchema.meta({
  description: 'A catalogue-backed item path of the activity type, e.g. sets.exercise',
})

const catalogVersionSchema = z.string().meta({ description: 'Version of the catalogue resolved against' })

const nullableCatalogKeySchema = exerciseCatalogKeySchema
  .nullable()
  .meta({ description: 'The catalogue entry the name stands for, null when dismissed or unmapped' })

export const itemValueIdentityQuerySchema = z
  .object({
    field: catalogFieldPathSchema,
    value: z.string().trim().min(1).meta({ description: 'The logged name, e.g. "DB Curl"' }),
  })
  .meta({ description: 'Which name of an item path to resolve', id: 'ItemValueIdentityQuery' })

export type ItemValueIdentityQuery = z.infer<typeof itemValueIdentityQuerySchema>

export const setItemValueIdentityBodySchema = z
  .object({
    field: catalogFieldPathSchema,
    key: exerciseCatalogKeySchema.nullable().meta({
      description: 'The catalogue entry the name stands for, or null to say it is not in the catalogue',
    }),
    value: z.string().trim().min(1).meta({ description: 'The logged name, e.g. "DB Curl"' }),
  })
  .meta({
    description:
      "Map a logged name to a catalogue entry, or dismiss it as not in the catalogue. Replaces the user's earlier decision for the name; no activity is rewritten.",
    id: 'SetItemValueIdentityBody',
  })

export type SetItemValueIdentityBody = z.infer<typeof setItemValueIdentityBodySchema>

export const itemValueIdentityOtherValueSchema = z
  .object({
    count: z.number().int().meta({ description: 'Number of activities with this value' }),
    value: z.string(),
  })
  .meta({ id: 'ItemValueIdentityOtherValue' })

export type ItemValueIdentityOtherValue = z.infer<typeof itemValueIdentityOtherValueSchema>

export const itemValueIdentitySchema = z
  .object({
    catalog: dataFieldCatalogSchema,
    catalog_key: nullableCatalogKeySchema,
    catalog_version: catalogVersionSchema,
    entry: exerciseCatalogEntrySchema
      .optional()
      .meta({ description: 'The catalogue entry, when there is a key' }),
    field: z.string(),
    other_values: z.array(itemValueIdentityOtherValueSchema).meta({
      description: "The user's other logged values of this item path that resolve to the same entry",
    }),
    state: itemValueIdentityStateSchema,
    value: z.string(),
  })
  .meta({
    description: 'What catalogue entry a logged name stands for, and why',
    id: 'ItemValueIdentity',
  })

export type ItemValueIdentity = z.infer<typeof itemValueIdentitySchema>

export const itemValueIdentityResponseSchema = createDataResponseSchema(itemValueIdentitySchema).meta({
  id: 'ItemValueIdentityResponse',
})

export type ItemValueIdentityResponse = z.infer<typeof itemValueIdentityResponseSchema>

export const unmappedItemValuesQuerySchema = z
  .object({ field: catalogFieldPathSchema })
  .meta({ description: 'Which item path to list the unmapped names of', id: 'UnmappedItemValuesQuery' })

export type UnmappedItemValuesQuery = z.infer<typeof unmappedItemValuesQuerySchema>

export const unmappedItemValueSchema = z
  .object({
    count: z.number().int().meta({ description: 'Number of activities with this value' }),
    last_used: iso8601DateTimeSchema.meta({ description: 'Start time of the latest activity with it' }),
    suggestions: z
      .array(exerciseCatalogEntrySchema)
      .meta({ description: 'Up to three catalogue entries the name may stand for, best first' }),
    value: z.string(),
  })
  .meta({ id: 'UnmappedItemValue' })

export type UnmappedItemValue = z.infer<typeof unmappedItemValueSchema>

export const unmappedItemValuesSchema = z
  .object({
    catalog: dataFieldCatalogSchema,
    catalog_version: catalogVersionSchema,
    field: z.string(),
    values: z.array(unmappedItemValueSchema).meta({ description: 'Most used first' }),
  })
  .meta({
    description:
      'The logged names of an item path that match no catalogue entry and that the user has neither mapped nor dismissed',
    id: 'UnmappedItemValues',
  })

export type UnmappedItemValues = z.infer<typeof unmappedItemValuesSchema>

export const unmappedItemValuesResponseSchema = createDataResponseSchema(unmappedItemValuesSchema).meta({
  id: 'UnmappedItemValuesResponse',
})

export type UnmappedItemValuesResponse = z.infer<typeof unmappedItemValuesResponseSchema>
