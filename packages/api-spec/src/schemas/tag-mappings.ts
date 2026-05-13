/**
 * Tag mapping schemas — used for programmatic tag display name mapping.
 *
 * Tags have been absorbed into activities. Tag definitions have been replaced
 * by activity type definitions. Only tag mapping schemas remain, used by
 * the settings service for Oura programmatic tag naming.
 */

import { z } from 'zod'

/**
 * Set tag mapping body schema.
 */
export const setTagMappingBodySchema = z
  .object({
    icon: z.string().optional().meta({
      description:
        'Emoji character, unicode name, or URL (http/https) to an image (SVG/PNG) to use as tag icon',
    }),
    name: z.string().min(1).meta({ description: 'Display name for the tag' }),
    tag_key: z.string().min(1).meta({ description: 'The programmatic tag identifier to map' }),
  })
  .meta({ id: 'SetTagMappingBody' })

export type SetTagMappingBody = z.infer<typeof setTagMappingBodySchema>
