import { z } from 'zod'

import { createDataResponseSchema } from './common.ts'

export const metricCatalogGroups = [
  'lipids',
  'glucose',
  'blood_count',
  'vitamins_minerals',
  'thyroid',
  'hormones',
  'organ_function',
  'inflammation',
  'body_measurements',
  'body_composition',
] as const

export const metricCatalogGroupSchema = z.enum(metricCatalogGroups).meta({
  description: 'A group of the built-in metric catalogue',
  id: 'MetricCatalogGroup',
})

export type MetricCatalogGroup = z.infer<typeof metricCatalogGroupSchema>

export const metricCatalogUnitSchema = z
  .object({
    aliases: z
      .array(z.string())
      .optional()
      .meta({ description: 'Other spellings of this unit, e.g. `mcg/L` for `µg/L`' }),
    factor: z.number().meta({
      description: 'Multiplier to the stored unit: stored = (value + (offset ?? 0)) * factor',
    }),
    offset: z.number().optional().meta({
      description:
        'Added to the value before it is multiplied by factor: stored = (value + offset) * factor; the inverse is value = stored / factor - offset',
    }),
    unit: z.string().min(1).meta({ description: 'The unit, e.g. `mg/dL`' }),
  })
  .meta({
    description:
      'A unit a catalogue metric accepts besides its stored unit, with the conversion to the stored unit: stored = (value + (offset ?? 0)) * factor',
    id: 'MetricCatalogUnit',
  })

export type MetricCatalogUnit = z.infer<typeof metricCatalogUnitSchema>

const metricCatalogEntryShape = {
  aliases: z.array(z.string()).meta({ description: 'Other names that identify exactly this metric' }),
  display_name: z.string().min(1).meta({ description: 'Human-readable display name' }),
  group: metricCatalogGroupSchema,
  name: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .meta({ description: 'Snake_case identifier, the metric name the metric gets when it is used' }),
  unit: z.string().min(1).meta({ description: 'The unit the metric is stored in' }),
  unit_aliases: z.array(z.string()).optional().meta({ description: 'Other spellings of the stored unit' }),
  units: z.array(metricCatalogUnitSchema).meta({
    description: 'The other units the metric accepts, each converted to the stored unit',
  }),
}

export const storedMetricCatalogEntrySchema = z.object(metricCatalogEntryShape).meta({
  description: 'A metric as stored in the built-in catalogue file',
  id: 'StoredMetricCatalogEntry',
})

export type StoredMetricCatalogEntry = z.infer<typeof storedMetricCatalogEntrySchema>

export const metricCatalogGroupInfoSchema = z
  .object({
    key: metricCatalogGroupSchema,
    name: z.string().meta({ description: 'Display name' }),
  })
  .meta({ description: 'A group of the metric catalogue', id: 'MetricCatalogGroupInfo' })

export type MetricCatalogGroupInfo = z.infer<typeof metricCatalogGroupInfoSchema>

export const storedMetricCatalogSchema = z
  .object({
    entries: z.array(storedMetricCatalogEntrySchema),
    groups: z.array(metricCatalogGroupInfoSchema),
    version: z.string(),
  })
  .meta({ description: 'The built-in metric catalogue file', id: 'StoredMetricCatalog' })

export type StoredMetricCatalog = z.infer<typeof storedMetricCatalogSchema>

export const metricCatalogEntrySchema = z
  .object({
    ...metricCatalogEntryShape,
    in_use: z.boolean().meta({
      description:
        "Whether the user already has a metric with this name; a metric in use is the user's own and keeps its unit",
    }),
    in_use_unit: z.string().optional().meta({
      description:
        "The unit of the user's metric of this name, present only when the metric is in use; it may differ from `unit`",
    }),
  })
  .meta({ description: 'A metric of the built-in catalogue', id: 'MetricCatalogEntry' })

export type MetricCatalogEntry = z.infer<typeof metricCatalogEntrySchema>

export const metricCatalogQuerySchema = z
  .object({
    q: z.string().max(100).optional().meta({
      description: 'Search words: matches word prefixes of the name, display name and aliases',
    }),
  })
  .meta({ description: 'List the built-in metric catalogue', id: 'MetricCatalogQuery' })

export type MetricCatalogQuery = z.infer<typeof metricCatalogQuerySchema>

export const metricCatalogResultSchema = z
  .object({
    entries: z.array(metricCatalogEntrySchema),
    groups: z.array(metricCatalogGroupInfoSchema),
    version: z.string().meta({ description: 'Catalogue version' }),
  })
  .meta({ description: 'The matching catalogue metrics', id: 'MetricCatalogResult' })

export type MetricCatalogResult = z.infer<typeof metricCatalogResultSchema>

export const metricCatalogResponseSchema = createDataResponseSchema(metricCatalogResultSchema).meta({
  id: 'MetricCatalogResponse',
})

export type MetricCatalogResponse = z.infer<typeof metricCatalogResponseSchema>
