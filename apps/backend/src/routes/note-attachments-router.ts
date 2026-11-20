import {
  type BaseResponse,
  type DeleteNoteAttachmentQuery,
  deleteNoteAttachmentQuerySchema,
  type DeleteNoteAttachmentResponse,
  NOTE_ATTACHMENT_MAX_BYTES,
  type NoteAttachmentContentQuery,
  noteAttachmentContentQuerySchema,
  type NoteAttachmentResponse,
  type NoteAttachmentsQuery,
  noteAttachmentsQuerySchema,
  type NoteAttachmentsResponse,
} from '@aurboda/api-spec'

import { singleUpload } from '../api/upload.ts'
import {
  addNoteAttachment,
  defaultNoteAttachmentDeps,
  deleteNoteAttachment,
  getNoteAttachmentContent,
  listDeletedNoteAttachments,
  listNoteAttachments,
  type NoteAttachmentDeps,
  noteAttachmentFailure,
  restoreNoteAttachmentById,
} from '../services/note-attachments.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

const upload = singleUpload({
  field: 'file',
  fields: 2,
  fileSize: NOTE_ATTACHMENT_MAX_BYTES,
  tooLargeMessage: noteAttachmentFailure('too_large').message,
})

const NOT_FOUND = { error: 'Attachment not found', success: false }

/** Mounted next to the notes router at `/notes`: the pictures and recordings of a journal entry. */
export const createNoteAttachmentsRouter = (
  authMiddleware: AnyMiddleware,
  deps: NoteAttachmentDeps = defaultNoteAttachmentDeps,
): TypedRouter => {
  const router = typedRouter()

  router.post<{ id: string }, NoteAttachmentResponse>(
    '/:id/attachments',
    authMiddleware,
    upload,
    async (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded', success: false })
      const result = await addNoteAttachment(req.user!, req.params.id, req.file.buffer, deps)
      if (!result.ok) {
        const { message, status } = noteAttachmentFailure(result.reason)
        return res.status(status).json({ error: message, success: false })
      }
      res.status(201).json({ data: result.value, success: true })
    },
  )

  router.get<{ id: string }, NoteAttachmentsResponse, unknown, NoteAttachmentsQuery>(
    '/:id/attachments',
    authMiddleware,
    validateQuery(noteAttachmentsQuerySchema),
    async (req, res) => {
      const result = req.query.deleted
        ? await listDeletedNoteAttachments(req.user!, req.params.id, deps)
        : await listNoteAttachments(req.user!, req.params.id, deps)
      if (!result.ok) {
        const { message, status } = noteAttachmentFailure(result.reason)
        return res.status(status).json({ error: message, success: false })
      }
      res.json({ data: result.value, success: true })
    },
  )

  router.get<
    { id: string; attachment_id: string },
    BaseResponse | Buffer,
    unknown,
    NoteAttachmentContentQuery
  >(
    '/:id/attachments/:attachment_id',
    authMiddleware,
    validateQuery(noteAttachmentContentQuerySchema),
    async (req, res) => {
      const maxEdge = req.query.max_edge === undefined ? undefined : Number(req.query.max_edge)
      const result = await getNoteAttachmentContent(
        req.user!,
        req.params.id,
        req.params.attachment_id,
        maxEdge,
        deps,
      )
      if (!result.ok) return res.status(404).json(NOT_FOUND)
      res.set('Content-Type', result.value.mime)
      res.set('X-Content-Type-Options', 'nosniff')
      res.set('Content-Disposition', 'inline')
      res.set('Cache-Control', 'private, max-age=31536000, immutable')
      res.send(result.value.bytes)
    },
  )

  router.delete<
    { id: string; attachment_id: string },
    DeleteNoteAttachmentResponse,
    unknown,
    DeleteNoteAttachmentQuery
  >(
    '/:id/attachments/:attachment_id',
    authMiddleware,
    validateQuery(deleteNoteAttachmentQuerySchema),
    async (req, res) => {
      const deleted = await deleteNoteAttachment(
        req.user!,
        req.params.id,
        req.params.attachment_id,
        { purge: req.query.purge === true },
        deps,
      )
      if (!deleted) return res.status(404).json(NOT_FOUND)
      res.json({ success: true })
    },
  )

  router.post<{ id: string; attachment_id: string }, NoteAttachmentResponse>(
    '/:id/attachments/:attachment_id/restore',
    authMiddleware,
    async (req, res) => {
      const result = await restoreNoteAttachmentById(req.user!, req.params.id, req.params.attachment_id, deps)
      if (!result.ok) {
        const { message, status } = noteAttachmentFailure(result.reason)
        return res.status(status).json({ error: message, success: false })
      }
      res.json({ data: result.value, success: true })
    },
  )

  return router
}
