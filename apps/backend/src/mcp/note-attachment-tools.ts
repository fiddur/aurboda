/** Mirrors the REST `/notes/:id/attachments` capabilities. */
import {
  addNoteAttachmentInputSchema,
  DELETED_NOTE_RETENTION_DAYS,
  INLINE_PICTURE_HINT,
  MAX_ATTACHMENTS_PER_NOTE,
  NOTE_ATTACHMENT_MAX_BYTES,
  NOTE_ATTACHMENT_MCP_IMAGE_EDGE,
  NOTE_ATTACHMENT_MCP_MAX_BYTES,
} from '@aurboda/api-spec'
import { z } from 'zod'

import {
  addNoteAttachment,
  defaultNoteAttachmentDeps,
  deleteNoteAttachment,
  getNoteAttachmentForAssistant,
  listDeletedNoteAttachments,
  type NoteAttachmentDeps,
  noteAttachmentFailure,
  restoreNoteAttachmentById,
} from '../services/note-attachments.ts'
import { type TokenBucketLimiter, tooManyRequestsMessage } from '../services/rate-limit.ts'
import { errorResponse, imageResponse, jsonResponse, type McpServer } from './helpers.ts'

export interface NoteAttachmentToolsDeps {
  attachments?: NoteAttachmentDeps
  /** The per-account upload budget the REST upload routes draw on too. */
  uploadLimiter?: TokenBucketLimiter
}

const MB = 1024 * 1024

/**
 * The MCP endpoint parses at most 4 MB of JSON, and base64 takes four characters for every three
 * bytes, so about 3 MB of file is what arrives in practice; the 5 MB check is the backstop.
 */
const PRACTICAL_MCP_MB = 3

const noteIdSchema = z.string().uuid().describe('The journal entry (note) the attachment is on')
const attachmentIdSchema = z.string().uuid().describe('The attachment ID')

const DIARY_FLOW =
  'To transcribe photographed diary pages: search_notes with needs_text: true finds the entries that have pictures and no text yet; get_note_attachment reads each picture in `position` order; then update_note with the transcribed text (pass expected_updated_at). The photos stay attached as the original.'

export const registerNoteAttachmentTools = (
  server: McpServer,
  user: string,
  deps: NoteAttachmentToolsDeps = {},
) => {
  const attachments = deps.attachments ?? defaultNoteAttachmentDeps

  server.tool(
    'add_note_attachment',
    `Attach a picture or a recording to a journal entry (a "time" or "day" note). A picture (PNG, JPEG, WebP, GIF or HEIC) is stored as WebP, turned upright, without its metadata, with its longest edge at most 3000 px; a recording (WebM, Ogg, MP4/M4A, MP3 or WAV) is stored as it is. Attachments keep upload order as page order. Over MCP a file may be at most ${NOTE_ATTACHMENT_MCP_MAX_BYTES / MB} MB decoded, but the request body is limited to 4 MB of JSON, so about ${PRACTICAL_MCP_MB} MB is the practical limit. For anything larger than a few hundred kB, or a file on disk, create_upload_url with target note_attachment is the better route: the file goes straight to a URL, up to ${NOTE_ATTACHMENT_MAX_BYTES / MB} MB. An entry holds at most ${MAX_ATTACHMENTS_PER_NOTE}. ${INLINE_PICTURE_HINT} ${DIARY_FLOW}`,
    { ...addNoteAttachmentInputSchema.shape },
    async ({ note_id, data }) => {
      const buffer = Buffer.from(data, 'base64')
      if (buffer.length > NOTE_ATTACHMENT_MCP_MAX_BYTES) {
        return errorResponse(
          `That file is too large to send over MCP (at most ${NOTE_ATTACHMENT_MCP_MAX_BYTES / MB} MB).`,
        )
      }
      const budget = deps.uploadLimiter?.take(user)
      if (budget && !budget.allowed) return errorResponse(tooManyRequestsMessage(budget.retry_after_seconds))
      const result = await addNoteAttachment(user, note_id, buffer, attachments)
      if (!result.ok) return errorResponse(noteAttachmentFailure(result.reason).message)
      return jsonResponse({ data: result.value, success: true })
    },
  )

  server.tool(
    'get_note_attachment',
    `Read an attachment of a journal entry. A picture comes back as an image (JPEG, longest edge at most ${NOTE_ATTACHMENT_MCP_IMAGE_EDGE} px) with its metadata; a recording comes back as its metadata only, since it can be played in the app. The server does not transcribe anything. ${DIARY_FLOW}`,
    { attachment_id: attachmentIdSchema, note_id: noteIdSchema },
    async ({ note_id, attachment_id }) => {
      const result = await getNoteAttachmentForAssistant(user, note_id, attachment_id, attachments)
      if (!result.ok) return errorResponse('Attachment not found')
      if (result.value.kind === 'audio') {
        return jsonResponse({
          data: result.value.attachment,
          message: 'A recording: it can be played in the app. Its audio is not available here.',
          success: true,
        })
      }
      return imageResponse(
        result.value.jpeg,
        'image/jpeg',
        JSON.stringify({ data: result.value.attachment, success: true }, null, 2),
      )
    },
  )

  server.tool(
    'delete_note_attachment',
    `Delete an attachment of a journal entry. It can be restored with restore_note_attachment for ${DELETED_NOTE_RETENTION_DAYS} days (see list_deleted_note_attachments); purge: true removes it for good at once.`,
    {
      attachment_id: attachmentIdSchema,
      note_id: noteIdSchema,
      purge: z.boolean().optional().describe('true removes the attachment for good at once'),
    },
    async ({ note_id, attachment_id, purge }) => {
      const deleted = await deleteNoteAttachment(
        user,
        note_id,
        attachment_id,
        { purge: purge === true },
        attachments,
      )
      if (!deleted) return errorResponse('Attachment not found')
      return jsonResponse({ success: true })
    },
  )

  server.tool(
    'restore_note_attachment',
    `Restore a deleted attachment of a journal entry. Refused when the entry already holds ${MAX_ATTACHMENTS_PER_NOTE}.`,
    { attachment_id: attachmentIdSchema, note_id: noteIdSchema },
    async ({ note_id, attachment_id }) => {
      const result = await restoreNoteAttachmentById(user, note_id, attachment_id, attachments)
      if (!result.ok) return errorResponse(noteAttachmentFailure(result.reason).message)
      return jsonResponse({ data: result.value, success: true })
    },
  )

  server.tool(
    'list_deleted_note_attachments',
    `List a journal entry's deleted attachments that can still be restored, newest deletion first, each with deleted_at and purge_at (${DELETED_NOTE_RETENTION_DAYS} days after deletion).`,
    { note_id: noteIdSchema },
    async ({ note_id }) => {
      const result = await listDeletedNoteAttachments(user, note_id, attachments)
      if (!result.ok) return errorResponse(noteAttachmentFailure(result.reason).message)
      return jsonResponse({ data: result.value, success: true })
    },
  )
}
