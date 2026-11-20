import {
  type AddNoteBody,
  addNoteBodySchema,
  type DeleteNoteQuery,
  deleteNoteQuerySchema,
  type DeleteNoteResponse,
  type NoteConflictResponse,
  type NoteResponse,
  type NoteRevisionsResponse,
  type NotesQuery,
  notesQueryRangeSchema,
  notesQuerySchema,
  type NotesRangeQuery,
  type NotesResponse,
  type NotesSearchQuery,
  notesSearchQuerySchema,
  type NotesSearchResponse,
  type UpdateNoteBody,
  updateNoteBodySchema,
} from '@aurboda/api-spec'

import {
  addNote,
  deleteNoteById,
  getNoteForUser,
  getNoteRevisionsById,
  getNotesForEntity,
  getNotesInRange,
  listDeletedNotes,
  restoreNoteById,
  searchNotesForUser,
  updateNote,
} from '../services/mutations.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery, validateQueryOneOf } from '../validation.ts'

/** `from`/`to` lists every comment anchored in a time window; otherwise the comments on one entity. */
const isRangeQuery = (query: Record<string, unknown>): boolean =>
  query.from !== undefined || query.to !== undefined

const errorStatus = (errorCode: string | undefined): number =>
  errorCode === 'not_found' ? 404 : errorCode === 'conflict' ? 409 : 400

export const createNotesRouter = (authMiddleware: AnyMiddleware): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, NotesResponse, unknown, NotesQuery | NotesRangeQuery>(
    '/',
    authMiddleware,
    validateQueryOneOf((query) => (isRangeQuery(query) ? notesQueryRangeSchema : notesQuerySchema)),
    async (req, res) => {
      const user = req.user!
      const notes =
        'from' in req.query
          ? await getNotesInRange(user, new Date(req.query.from), new Date(req.query.to), req.query.tz, {
              needs_text: req.query.needs_text,
            })
          : await getNotesForEntity(user, req.query.entity_type, req.query.entity_id)
      res.json({ data: notes, success: true })
    },
  )

  router.get<Record<string, never>, NotesSearchResponse, unknown, NotesSearchQuery>(
    '/search',
    authMiddleware,
    validateQuery(notesSearchQuerySchema),
    async (req, res) => {
      const result = await searchNotesForUser(req.user!, req.query)
      if (!result.success) {
        return res.status(400).json({ error: result.error, success: false })
      }
      res.json({ data: result.data, next_cursor: result.next_cursor, success: true })
    },
  )

  router.get<Record<string, never>, NotesResponse>('/deleted', authMiddleware, async (req, res) => {
    res.json({ data: await listDeletedNotes(req.user!), success: true })
  })

  router.post<Record<string, never>, NoteResponse, AddNoteBody>(
    '/',
    authMiddleware,
    validateBody(addNoteBodySchema),
    async (req, res) => {
      const { entity_type, entity_id, content, start_time, end_time, date, title, tags } = req.body
      const user = req.user!

      const result = await addNote(user, {
        content,
        date,
        end_time,
        entity_id,
        entity_type,
        start_time,
        tags,
        title,
      })

      if (!result.success) {
        return res.status(400).json({ error: result.error, success: false })
      }

      res.json({ data: result.data, success: true })
    },
  )

  router.patch<{ id: string }, NoteResponse | NoteConflictResponse, UpdateNoteBody>(
    '/:id',
    authMiddleware,
    validateBody(updateNoteBodySchema),
    async (req, res) => {
      const { id } = req.params
      const user = req.user!

      const result = await updateNote(user, id, req.body)

      if (result.errorCode === 'conflict' && result.data) {
        return res.status(409).json({ data: result.data, error: result.error!, success: false })
      }
      if (!result.success) {
        return res.status(errorStatus(result.errorCode)).json({ error: result.error, success: false })
      }

      res.json({ data: result.data, success: true })
    },
  )

  router.delete<{ id: string }, DeleteNoteResponse, unknown, DeleteNoteQuery>(
    '/:id',
    authMiddleware,
    validateQuery(deleteNoteQuerySchema),
    async (req, res) => {
      const { id } = req.params
      const user = req.user!

      const result = await deleteNoteById(user, id, { purge: req.query.purge === true })

      if (!result.success) {
        return res.status(404).json({ error: 'Note not found', success: false })
      }

      res.json({ success: true })
    },
  )

  router.post<{ id: string }, NoteResponse>('/:id/restore', authMiddleware, async (req, res) => {
    const result = await restoreNoteById(req.user!, req.params.id)
    if (!result.success) {
      return res.status(errorStatus(result.errorCode)).json({ error: result.error, success: false })
    }
    res.json({ data: result.data, success: true })
  })

  router.get<{ id: string }, NoteResponse>('/:id', authMiddleware, async (req, res) => {
    const result = await getNoteForUser(req.user!, req.params.id)
    if (!result.success) return res.status(404).json({ error: result.error, success: false })
    res.json({ data: result.data, success: true })
  })

  router.get<{ id: string }, NoteRevisionsResponse>('/:id/revisions', authMiddleware, async (req, res) => {
    const result = await getNoteRevisionsById(req.user!, req.params.id)
    if (!result.success) {
      return res.status(404).json({ error: result.error, success: false })
    }
    res.json({ data: result.data, success: true })
  })

  return router
}
