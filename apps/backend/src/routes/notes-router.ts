import type { RequestHandler } from 'express'
import type { ZodError } from 'zod'

/**
 * Notes route group.
 *
 * Handles: /notes/*
 */
import {
  type AddNoteBody,
  addNoteBodySchema,
  type DeleteNoteResponse,
  type NoteResponse,
  notesQueryRangeSchema,
  notesQuerySchema,
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
import { validateBody } from '../validation.ts'

/** Flatten Zod issues into the single error string the response schema carries. */
const describeIssues = (error: ZodError): string =>
  error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`).join('; ')

export const createNotesRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()

  // Two reads share this route: `from`/`to` lists every comment anchored in a
  // time window, `entity_type`/`entity_id` lists the comments on one entity.
  // Validation is manual because which schema applies depends on the params.
  router.get<Record<string, never>, NotesResponse>('/', authMiddleware, async (req, res) => {
    const user = req.user!

    if (req.query.from !== undefined || req.query.to !== undefined) {
      const range = notesQueryRangeSchema.safeParse(req.query)
      if (!range.success) {
        return res.status(400).json({ error: describeIssues(range.error), success: false })
      }
      const notes = await getNotesInRange(user, new Date(range.data.from), new Date(range.data.to))
      return res.json({ data: notes, success: true })
    }

    const entity = notesQuerySchema.safeParse(req.query)
    if (!entity.success) {
      return res.status(400).json({ error: describeIssues(entity.error), success: false })
    }

    const notes = await getNotesForEntity(user, entity.data.entity_type, entity.data.entity_id)
    res.json({ data: notes, success: true })
  })

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
        const status = result.error === 'Note not found' ? 404 : 400
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
