import { z } from 'zod'

import { createDataResponseSchema, displayCategorySchema } from './common.ts'
import { dataSchemaDefinitionSchema } from './data-schema.ts'

export const activityTypeCatalogGroups = [
  'intake',
  'meals',
  'health',
  'symptoms',
  'recovery',
  'context',
] as const

export const activityTypeCatalogGroupSchema = z.enum(activityTypeCatalogGroups).meta({
  description: 'A group of the built-in activity type catalogue',
  id: 'ActivityTypeCatalogGroup',
})

export type ActivityTypeCatalogGroup = z.infer<typeof activityTypeCatalogGroupSchema>

const activityTypeCatalogNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/)

export const activityTypeCatalogSameAsSchema = z
  .object({
    apple_healthkit: z.array(z.string()).optional().meta({ description: 'Apple HealthKit type identifiers' }),
    garmin: z.array(z.string()).optional().meta({ description: 'Garmin Lifestyle Logging behaviours' }),
    health_connect: z.array(z.string()).optional().meta({ description: 'Health Connect record types' }),
    oura: z.array(z.string()).optional().meta({ description: 'Oura tag names' }),
  })
  .meta({
    description: 'The names or identifiers the same thing has in outside vocabularies',
    id: 'ActivityTypeCatalogSameAs',
  })

export type ActivityTypeCatalogSameAs = z.infer<typeof activityTypeCatalogSameAsSchema>

const activityTypeCatalogEntryShape = {
  aliases: z.array(z.string()).meta({ description: 'Other names that identify exactly this type' }),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .meta({ description: 'Hex color for timeline rendering' }),
  data_schema: dataSchemaDefinitionSchema.optional().meta({ description: 'The fields of the type' }),
  display_category: displayCategorySchema,
  display_name: z.string().min(1).meta({ description: 'Human-readable display name' }),
  group: activityTypeCatalogGroupSchema,
  icon: z.string().meta({ description: 'Emoji' }),
  name: activityTypeCatalogNameSchema.meta({
    description: 'Snake_case identifier, the activity type name the type gets when it is used',
  }),
  parent_type: activityTypeCatalogNameSchema.optional().meta({ description: 'Parent activity type name' }),
  same_as: activityTypeCatalogSameAsSchema,
}

export const storedActivityTypeCatalogEntrySchema = z.object(activityTypeCatalogEntryShape).meta({
  description: 'An activity type as stored in the built-in catalogue file',
  id: 'StoredActivityTypeCatalogEntry',
})

export type StoredActivityTypeCatalogEntry = z.infer<typeof storedActivityTypeCatalogEntrySchema>

export const activityTypeCatalogGroupInfoSchema = z
  .object({
    key: activityTypeCatalogGroupSchema,
    name: z.string().meta({ description: 'Display name' }),
  })
  .meta({ description: 'A group of the activity type catalogue', id: 'ActivityTypeCatalogGroupInfo' })

export type ActivityTypeCatalogGroupInfo = z.infer<typeof activityTypeCatalogGroupInfoSchema>

export const storedActivityTypeCatalogSchema = z
  .object({
    entries: z.array(storedActivityTypeCatalogEntrySchema),
    groups: z.array(activityTypeCatalogGroupInfoSchema),
    version: z.string(),
  })
  .meta({ description: 'The built-in activity type catalogue file', id: 'StoredActivityTypeCatalog' })

export type StoredActivityTypeCatalog = z.infer<typeof storedActivityTypeCatalogSchema>

export const activityTypeCatalogEntrySchema = z
  .object({
    ...activityTypeCatalogEntryShape,
    in_use: z.boolean().meta({
      description:
        "Whether the user already has a type with this name; a type in use is the user's own and may differ from this definition",
    }),
  })
  .meta({ description: 'An activity type of the built-in catalogue', id: 'ActivityTypeCatalogEntry' })

export type ActivityTypeCatalogEntry = z.infer<typeof activityTypeCatalogEntrySchema>

export const activityTypeCatalogQuerySchema = z
  .object({
    q: z.string().max(100).optional().meta({
      description: 'Search words: matches word prefixes of the name, display name and aliases',
    }),
  })
  .meta({ description: 'List the built-in activity type catalogue', id: 'ActivityTypeCatalogQuery' })

export type ActivityTypeCatalogQuery = z.infer<typeof activityTypeCatalogQuerySchema>

export const activityTypeCatalogResultSchema = z
  .object({
    entries: z.array(activityTypeCatalogEntrySchema),
    groups: z.array(activityTypeCatalogGroupInfoSchema),
    version: z.string().meta({ description: 'Catalogue version' }),
  })
  .meta({ description: 'The matching catalogue activity types', id: 'ActivityTypeCatalogResult' })

export type ActivityTypeCatalogResult = z.infer<typeof activityTypeCatalogResultSchema>

export const activityTypeCatalogResponseSchema = createDataResponseSchema(
  activityTypeCatalogResultSchema,
).meta({
  id: 'ActivityTypeCatalogResponse',
})

export type ActivityTypeCatalogResponse = z.infer<typeof activityTypeCatalogResponseSchema>
