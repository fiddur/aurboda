import type { RequestHandler, Router } from 'express'

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
  type NotesQuery,
  notesQuerySchema,
  type NotesResponse,
  type UpdateNoteBody,
  updateNoteBodySchema,
} from '@aurboda/api-spec'

import { addNote, deleteNoteById, getNotesForEntity, updateNoteContent } from '../services/mutations.ts'
import { typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

export const createNotesRouter = (authMiddleware: RequestHandler): Router => {
  const router = typedRouter()

  // GET /notes - Get notes for an entity
  router.get<Record<string, never>, NotesResponse, unknown, NotesQuery>(
    '/',
    authMiddleware,
    validateQuery(notesQuerySchema),
    async (req, res) => {
      const { entity_type, entity_id } = req.query
      const user = req.user!

      const notes = await getNotesForEntity(user, entity_type, entity_id)
      res.json({ data: notes, success: true })
    },
  )

  // POST /notes - Add a note
  router.post<Record<string, never>, NoteResponse, AddNoteBody>(
    '/',
    authMiddleware,
    validateBody(addNoteBodySchema),
    async (req, res) => {
      const { entity_type, entity_id, content } = req.body
      const user = req.user!

      const result = await addNote(user, { content, entity_id, entity_type })

      if (!result.success) {
        return res.status(400).json({ error: result.error, success: false })
      }

      res.json({ data: result.data, success: true })
    },
  )

  // PATCH /notes/:id - Update a note
  router.patch<{ id: string }, NoteResponse, UpdateNoteBody>(
    '/:id',
    authMiddleware,
    validateBody(updateNoteBodySchema),
    async (req, res) => {
      const { id } = req.params
      const { content } = req.body
      const user = req.user!

      const result = await updateNoteContent(user, id, content)

      if (!result.success) {
        return res.status(404).json({ error: result.error, success: false })
      }

      res.json({ data: result.data, success: true })
    },
  )

  // DELETE /notes/:id - Delete a note
  router.delete<{ id: string }, DeleteNoteResponse>('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params
    const user = req.user!

    const result = await deleteNoteById(user, id)

    if (!result.success) {
      return res.status(404).json({ error: 'Note not found', success: false })
    }

    res.json({ success: true })
  })

  return router as unknown as Router
}
