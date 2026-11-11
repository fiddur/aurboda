import type { RequestHandler } from 'express'

import {
  type AddNoteBody,
  addNoteBodySchema,
  type DeleteNoteResponse,
  type NoteResponse,
  type NotesQuery,
  notesQueryRangeSchema,
  notesQuerySchema,
  type NotesRangeQuery,
  type NotesResponse,
  type UpdateNoteBody,
  updateNoteBodySchema,
} from '@aurboda/api-spec'

import {
  addNote,
  deleteNoteById,
  getNotesForEntity,
  getNotesInRange,
  updateNote,
} from '../services/mutations.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQueryOneOf } from '../validation.ts'

/** `from`/`to` lists every comment anchored in a time window; otherwise the comments on one entity. */
const isRangeQuery = (query: Record<string, unknown>): boolean =>
  query.from !== undefined || query.to !== undefined

export const createNotesRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, NotesResponse, unknown, NotesQuery | NotesRangeQuery>(
    '/',
    authMiddleware,
    validateQueryOneOf((query) => (isRangeQuery(query) ? notesQueryRangeSchema : notesQuerySchema)),
    async (req, res) => {
      const user = req.user!
      const notes =
        'from' in req.query
          ? await getNotesInRange(user, new Date(req.query.from), new Date(req.query.to))
          : await getNotesForEntity(user, req.query.entity_type, req.query.entity_id)
      res.json({ data: notes, success: true })
    },
  )

  router.post<Record<string, never>, NoteResponse, AddNoteBody>(
    '/',
    authMiddleware,
    validateBody(addNoteBodySchema),
    async (req, res) => {
      const { entity_type, entity_id, content, start_time, end_time } = req.body
      const user = req.user!

      const result = await addNote(user, { content, end_time, entity_id, entity_type, start_time })

      if (!result.success) {
        return res.status(400).json({ error: result.error, success: false })
      }

      res.json({ data: result.data, success: true })
    },
  )

  router.patch<{ id: string }, NoteResponse, UpdateNoteBody>(
    '/:id',
    authMiddleware,
    validateBody(updateNoteBodySchema),
    async (req, res) => {
      const { id } = req.params
      const { content, start_time, end_time } = req.body
      const user = req.user!

      const result = await updateNote(user, id, { content, end_time, start_time })

      if (!result.success) {
        const status = result.errorCode === 'not_found' ? 404 : 400
        return res.status(status).json({ error: result.error, success: false })
      }

      res.json({ data: result.data, success: true })
    },
  )

  router.delete<{ id: string }, DeleteNoteResponse>('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    const result = await deleteNoteById(user, id)

    if (!result.success) {
      return res.status(404).json({ error: 'Note not found', success: false })
    }

    res.json({ success: true })
  })

  return router
}
