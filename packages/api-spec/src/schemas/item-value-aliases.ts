import { z } from 'zod'

import { createDataResponseSchema, dataFieldPathSchema, iso8601DateTimeSchema } from './common.ts'

export const itemValueAliasSchema = z
  .object({
    alias: z.string().meta({ description: 'The spelling that is mapped away, e.g. "Dumbbell Bicep Curl"' }),
    created_at: iso8601DateTimeSchema,
    field: dataFieldPathSchema.meta({ description: 'Item path the alias applies to, e.g. sets.exercise' }),
    id: z.string().uuid(),
    value: z.string().meta({ description: 'The name it is stored as, e.g. "Dumbbell Curl"' }),
  })
  .meta({
    description:
      'A merged item value: any activity written with the alias in this item path is stored with the value instead. Aliases are per user and per item path, whatever the activity type.',
    id: 'ItemValueAlias',
  })

export type ItemValueAlias = z.infer<typeof itemValueAliasSchema>

export const itemValueAliasesQuerySchema = z
  .object({
    field: dataFieldPathSchema.meta({ description: 'Item path to list the aliases of, e.g. sets.exercise' }),
  })
  .meta({ id: 'ItemValueAliasesQuery' })

export type ItemValueAliasesQuery = z.infer<typeof itemValueAliasesQuerySchema>

export const itemValueAliasesResponseSchema = createDataResponseSchema(z.array(itemValueAliasSchema)).meta({
  id: 'ItemValueAliasesResponse',
})

export type ItemValueAliasesResponse = z.infer<typeof itemValueAliasesResponseSchema>

export const mergeItemValuesBodySchema = z
  .object({
    field: dataFieldPathSchema.meta({
      description: 'A categorical item path of the activity type, e.g. sets.exercise',
    }),
    source: z.string().trim().min(1).meta({ description: 'The value to merge away' }),
    target: z.string().trim().min(1).meta({ description: 'The value to merge it into; may be new' }),
  })
  .meta({
    description:
      'Rewrites every item with the source value, in the activity type and its subtypes, to the target value, and keeps the source as an alias of the target so later writes map it too. A source that differs from the target only in case or whitespace only unifies the spelling.',
    id: 'MergeItemValuesBody',
  })

export type MergeItemValuesBody = z.infer<typeof mergeItemValuesBodySchema>

export const mergeItemValuesResultSchema = z
  .object({
    activities_updated: z.number().int().meta({ description: 'Activities whose items were rewritten' }),
    alias: itemValueAliasSchema
      .nullable()
      .meta({ description: 'The alias kept, null for a spelling-only merge' }),
  })
  .meta({ id: 'MergeItemValuesResult' })

export type MergeItemValuesResult = z.infer<typeof mergeItemValuesResultSchema>

export const mergeItemValuesResponseSchema = createDataResponseSchema(mergeItemValuesResultSchema).meta({
  id: 'MergeItemValuesResponse',
})

export type MergeItemValuesResponse = z.infer<typeof mergeItemValuesResponseSchema>
