import {
  type AddNoteTemplateBody,
  addNoteTemplateBodySchema,
  type DeleteNoteTemplateQuery,
  deleteNoteTemplateQuerySchema,
  type DeleteNoteTemplateResponse,
  type NoteTemplateResponse,
  type NoteTemplatesQuery,
  noteTemplatesQuerySchema,
  type NoteTemplatesResponse,
  type UpdateNoteTemplateBody,
  updateNoteTemplateBodySchema,
} from '@aurboda/api-spec'

import {
  addTemplate,
  defaultNoteTemplateDeps,
  deleteTemplate,
  listTemplates,
  type NoteTemplateDeps,
  restoreTemplate,
  updateTemplate,
} from '../services/note-templates.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

const statusOf = (reason: 'not_found' | 'invalid'): number => (reason === 'not_found' ? 404 : 400)

export const createNoteTemplatesRouter = (
  authMiddleware: AnyMiddleware,
  deps: NoteTemplateDeps = defaultNoteTemplateDeps,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, NoteTemplatesResponse, unknown, NoteTemplatesQuery>(
    '/',
    authMiddleware,
    validateQuery(noteTemplatesQuerySchema),
    async (req, res) => {
      res.json({ data: await listTemplates(req.user!, { deleted: req.query.deleted }, deps), success: true })
    },
  )

  router.post<Record<string, never>, NoteTemplateResponse, AddNoteTemplateBody>(
    '/',
    authMiddleware,
    validateBody(addNoteTemplateBodySchema),
    async (req, res) => {
      const result = await addTemplate(req.user!, req.body, deps)
      if (!result.ok) return res.status(statusOf(result.reason)).json({ error: result.error, success: false })
      res.status(201).json({ data: result.value, success: true })
    },
  )

  router.patch<{ id: string }, NoteTemplateResponse, UpdateNoteTemplateBody>(
    '/:id',
    authMiddleware,
    validateBody(updateNoteTemplateBodySchema),
    async (req, res) => {
      const result = await updateTemplate(req.user!, req.params.id, req.body, deps)
      if (!result.ok) return res.status(statusOf(result.reason)).json({ error: result.error, success: false })
      res.json({ data: result.value, success: true })
    },
  )

  router.delete<{ id: string }, DeleteNoteTemplateResponse, unknown, DeleteNoteTemplateQuery>(
    '/:id',
    authMiddleware,
    validateQuery(deleteNoteTemplateQuerySchema),
    async (req, res) => {
      if (!(await deleteTemplate(req.user!, req.params.id, { purge: req.query.purge === true }, deps))) {
        return res.status(404).json({ error: 'Template not found', success: false })
      }
      res.json({ success: true })
    },
  )

  router.post<{ id: string }, NoteTemplateResponse>('/:id/restore', authMiddleware, async (req, res) => {
    const result = await restoreTemplate(req.user!, req.params.id, deps)
    if (!result.ok) return res.status(statusOf(result.reason)).json({ error: result.error, success: false })
    res.json({ data: result.value, success: true })
  })

  return router
}
