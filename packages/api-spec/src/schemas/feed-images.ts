/**
 * Pictures a user adds to what they write (article prose, comments, activity
 * descriptions). Each is normalised to WebP on upload, stored in the writer's own
 * database, and served from a public URL that markdown embeds as `![](url)`.
 */
import { z } from 'zod'

import { baseResponseSchema, iso8601DateTimeSchema } from './common.ts'

export const MAX_FEED_IMAGES_PER_ACCOUNT = 500

export const MAX_FEED_IMAGE_BYTES = 10 * 1024 * 1024

export const FEED_IMAGE_MAX_EDGE = 1600

export const feedImageSchema = z
  .object({
    byte_size: z.number().int().meta({ description: 'Size of the stored WebP, in bytes' }),
    created_at: iso8601DateTimeSchema,
    height: z.number().int().meta({ description: 'Height of the stored picture, in pixels' }),
    id: z.string().uuid().meta({ description: 'Picture ID' }),
    url: z.string().meta({
      description:
        'Absolute public URL of the stored picture. Put it in markdown as `![description](url)`; anyone with the link can see it',
      example: 'https://aurboda.net/api/public/alice/images/1b4e28ba-2fa1-11d2-883f-0016d3cca427.webp',
    }),
    width: z.number().int().meta({ description: 'Width of the stored picture, in pixels' }),
  })
  .meta({
    description: `A picture added to something the user wrote, stored as WebP with its longest edge at most ${FEED_IMAGE_MAX_EDGE} px and no metadata`,
    id: 'FeedImage',
  })

export type FeedImage = z.infer<typeof feedImageSchema>

export const feedImageResponseSchema = baseResponseSchema
  .extend({ image: feedImageSchema.optional() })
  .meta({ id: 'FeedImageResponse' })

export type FeedImageResponse = z.infer<typeof feedImageResponseSchema>

export const feedImagesResponseSchema = baseResponseSchema
  .extend({
    images: z.array(feedImageSchema).meta({ description: 'Stored pictures, newest first' }),
    limit: z.number().int().meta({ description: 'How many pictures one account may store' }),
  })
  .meta({ id: 'FeedImagesResponse' })

export type FeedImagesResponse = z.infer<typeof feedImagesResponseSchema>

export const addFeedImageInputSchema = z
  .object({
    data_base64: z
      .string()
      .min(1)
      .max(Math.ceil(MAX_FEED_IMAGE_BYTES / 3) * 4)
      .meta({
        description: `The picture's bytes, base64-encoded (PNG, JPEG, WebP or GIF; at most ${MAX_FEED_IMAGE_BYTES / 1024 / 1024} MB decoded). It is stored as WebP with its longest edge at most ${FEED_IMAGE_MAX_EDGE} px, turned upright, and without its metadata (no camera or GPS position)`,
      }),
  })
  .meta({
    description:
      'Store a picture and get back its public URL, to embed in markdown as `![description](url)` in an article, comment or activity description',
    id: 'AddFeedImageInput',
  })

export type AddFeedImageInput = z.infer<typeof addFeedImageInputSchema>
