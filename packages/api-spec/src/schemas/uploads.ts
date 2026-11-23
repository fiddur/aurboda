/**
 * Short-lived, single-use upload URLs. An authenticated call mints a URL bound to one upload
 * target; the client then sends the raw bytes there with any HTTP client, no Authorization header,
 * and gets back what the target's own upload endpoint would have answered.
 */
import { z } from 'zod'

import { challengeSchema } from './challenges.ts'
import { baseResponseSchema, createDataResponseSchema, iso8601DateTimeSchema } from './common.ts'
import { feedImageSchema } from './feed-images.ts'
import { noteAttachmentSchema } from './note-attachments.ts'

export const uploadTargets = ['note_attachment', 'feed_image', 'challenge_banner', 'profile_avatar'] as const

export type UploadTarget = (typeof uploadTargets)[number]

/** How long a minted upload URL stays good. */
export const UPLOAD_URL_TTL_MINUTES = 15

export const uploadTargetSchema = z.enum(uploadTargets).meta({
  description:
    'What the upload becomes: note_attachment (a picture or a recording on a journal entry; needs note_id), feed_image (a picture to embed in markdown by its public URL), challenge_banner (the banner of a hosted challenge; needs challenge_id) or profile_avatar (your profile picture)',
  id: 'UploadTarget',
})

export const createUploadUrlBodySchema = z
  .object({
    challenge_id: z.string().uuid().optional().meta({
      description:
        'The hosted challenge whose banner to set. Required for challenge_banner, refused otherwise.',
    }),
    note_id: z.string().uuid().optional().meta({
      description:
        'The journal entry (a "time" or "day" note) to attach the file to. Required for note_attachment, refused otherwise.',
    }),
    target: uploadTargetSchema,
  })
  .meta({
    description: `Mint an upload URL good for one upload within ${UPLOAD_URL_TTL_MINUTES} minutes`,
    id: 'CreateUploadUrlBody',
  })

export type CreateUploadUrlBody = z.infer<typeof createUploadUrlBodySchema>

export const uploadUrlSchema = z
  .object({
    expires_at: iso8601DateTimeSchema.meta({ description: 'When the URL stops working if it is not used' }),
    max_bytes: z.number().int().meta({ description: 'The largest file the URL accepts, in bytes' }),
    method: z.literal('PUT').meta({
      description:
        'Send the raw bytes with PUT (any content type). POST with multipart/form-data and the file in field `file` works too.',
    }),
    target: uploadTargetSchema,
    upload_url: z.string().meta({
      description: 'Where to send the file. It is the credential: no Authorization header is needed.',
      example: 'https://aurboda.net/api/uploads/alice/3q2-7wEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    }),
  })
  .meta({ description: 'A single-use upload URL', id: 'UploadUrl' })

export type UploadUrl = z.infer<typeof uploadUrlSchema>

export const uploadUrlResponseSchema = createDataResponseSchema(uploadUrlSchema).meta({
  id: 'UploadUrlResponse',
})

export type UploadUrlResponse = z.infer<typeof uploadUrlResponseSchema>

export const uploadResultSchema = z
  .discriminatedUnion('target', [
    z
      .object({ attachment: noteAttachmentSchema, target: z.literal('note_attachment') })
      .meta({ description: 'The stored attachment', id: 'NoteAttachmentUploadResult' }),
    z
      .object({ image: feedImageSchema, target: z.literal('feed_image') })
      .meta({ description: 'The stored picture', id: 'FeedImageUploadResult' }),
    z
      .object({ challenge: challengeSchema, target: z.literal('challenge_banner') })
      .meta({ description: 'The challenge with its new banner', id: 'ChallengeBannerUploadResult' }),
    z
      .object({
        target: z.literal('profile_avatar'),
        url: z.string().meta({ description: 'Absolute URL of the profile picture' }),
      })
      .meta({ description: 'The new profile picture', id: 'ProfileAvatarUploadResult' }),
  ])
  .meta({ description: 'What an upload through an upload URL stored', id: 'UploadResult' })

export type UploadResult = z.infer<typeof uploadResultSchema>

export const uploadResultResponseSchema = baseResponseSchema
  .extend({ data: uploadResultSchema.optional() })
  .meta({ id: 'UploadResultResponse' })

export type UploadResultResponse = z.infer<typeof uploadResultResponseSchema>
