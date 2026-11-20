/**
 * Pictures and recordings on a journal entry (a `time` or `day` thread root). The bytes live in
 * the user's own database, so the account export carries them.
 */
import { z } from 'zod'

import {
  baseResponseSchema,
  createDataArrayResponseSchema,
  createDataResponseSchema,
  iso8601DateTimeSchema,
  queryBooleanSchema,
} from './common.ts'

const MB = 1024 * 1024

/** The largest file one upload may carry. */
export const NOTE_ATTACHMENT_MAX_BYTES = 20 * MB

export const MAX_ATTACHMENTS_PER_NOTE = 30

/** What all of a user's stored attachments may add up to; deleted ones count until purged. */
export const NOTE_ATTACHMENTS_ACCOUNT_BYTES = 2 * 1024 * MB

/** A picture is stored with its longest edge at most this many pixels: a photographed page stays legible. */
export const NOTE_IMAGE_MAX_EDGE = 3000

/** The downscaled sizes `max_edge` may ask for. */
export const NOTE_ATTACHMENT_PREVIEW_EDGES = ['400', '2000'] as const

/** The largest decoded file `add_note_attachment` accepts over MCP. */
export const NOTE_ATTACHMENT_MCP_MAX_BYTES = 5 * MB

/** The longest edge of a picture handed to an assistant over MCP. */
export const NOTE_ATTACHMENT_MCP_IMAGE_EDGE = 2000

export const noteAttachmentKinds = ['image', 'audio'] as const

export type NoteAttachmentKind = (typeof noteAttachmentKinds)[number]

export const noteAudioMimes = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'] as const

export type NoteAudioMime = (typeof noteAudioMimes)[number]

export const noteAttachmentSchema = z
  .object({
    created_at: iso8601DateTimeSchema,
    deleted_at: iso8601DateTimeSchema.optional().meta({
      description: 'When it was deleted. Only in the list of deleted attachments.',
    }),
    height: z.number().int().optional().meta({ description: 'Height in pixels (pictures only)' }),
    id: z.string().uuid().meta({ description: 'Attachment ID' }),
    kind: z.enum(noteAttachmentKinds).meta({ description: 'A picture or a recording' }),
    mime: z.string().meta({
      description: 'Stored type: image/webp for a picture, the recording’s own container for audio',
      example: 'image/webp',
    }),
    position: z.number().int().meta({ description: 'Order on the entry (upload order): page order' }),
    purge_at: iso8601DateTimeSchema.optional().meta({
      description: 'When a deleted attachment is removed for good. Only in the list of deleted attachments.',
    }),
    size: z.number().int().meta({ description: 'Stored size in bytes' }),
    width: z.number().int().optional().meta({ description: 'Width in pixels (pictures only)' }),
  })
  .meta({ description: 'A picture or a recording on a journal entry', id: 'NoteAttachment' })

export type NoteAttachment = z.infer<typeof noteAttachmentSchema>

export const noteAttachmentResponseSchema = createDataResponseSchema(noteAttachmentSchema).meta({
  id: 'NoteAttachmentResponse',
})

export type NoteAttachmentResponse = z.infer<typeof noteAttachmentResponseSchema>

export const noteAttachmentsResponseSchema = createDataArrayResponseSchema(noteAttachmentSchema).meta({
  id: 'NoteAttachmentsResponse',
})

export type NoteAttachmentsResponse = z.infer<typeof noteAttachmentsResponseSchema>

export const deleteNoteAttachmentResponseSchema = baseResponseSchema.meta({
  id: 'DeleteNoteAttachmentResponse',
})

export type DeleteNoteAttachmentResponse = z.infer<typeof deleteNoteAttachmentResponseSchema>

export const noteAttachmentsQuerySchema = z
  .object({
    deleted: queryBooleanSchema.optional().meta({
      description:
        'true lists the deleted attachments that can still be restored, with deleted_at and purge_at',
    }),
  })
  .meta({ id: 'NoteAttachmentsQuery' })

export type NoteAttachmentsQuery = z.infer<typeof noteAttachmentsQuerySchema>

export const noteAttachmentContentQuerySchema = z
  .object({
    max_edge: z
      .enum(NOTE_ATTACHMENT_PREVIEW_EDGES)
      .optional()
      .meta({
        description: `A picture downscaled to fit inside this many pixels (${NOTE_ATTACHMENT_PREVIEW_EDGES.join(' or ')}), as WebP. Ignored for a recording.`,
      }),
  })
  .meta({ id: 'NoteAttachmentContentQuery' })

export type NoteAttachmentContentQuery = z.infer<typeof noteAttachmentContentQuerySchema>

export const deleteNoteAttachmentQuerySchema = z
  .object({
    purge: queryBooleanSchema.optional().meta({
      description: 'true removes the attachment for good at once. Without it a delete can be undone.',
    }),
  })
  .meta({ id: 'DeleteNoteAttachmentQuery' })

export type DeleteNoteAttachmentQuery = z.infer<typeof deleteNoteAttachmentQuerySchema>

export const addNoteAttachmentInputSchema = z
  .object({
    data: z
      .string()
      .min(1)
      .max(Math.ceil(NOTE_ATTACHMENT_MCP_MAX_BYTES / 3) * 4)
      .meta({
        description: `The file's bytes, base64-encoded: a picture (PNG, JPEG, WebP or GIF) or a recording (WebM, Ogg, MP4/M4A, MP3 or WAV), at most ${NOTE_ATTACHMENT_MCP_MAX_BYTES / MB} MB decoded`,
      }),
    filename: z
      .string()
      .max(255)
      .optional()
      .meta({ description: 'The file name, for logs only; not stored' }),
    note_id: z
      .string()
      .uuid()
      .meta({ description: 'The journal entry (a "time" or "day" note) to attach it to' }),
  })
  .meta({ id: 'AddNoteAttachmentInput' })

export type AddNoteAttachmentInput = z.infer<typeof addNoteAttachmentInputSchema>
