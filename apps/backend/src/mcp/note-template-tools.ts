/** Mirrors the REST `/note-templates` capabilities. */
import {
  addNoteTemplateBodySchema,
  DELETED_NOTE_RETENTION_DAYS,
  updateNoteTemplateBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import {
  addTemplate,
  defaultNoteTemplateDeps,
  deleteTemplate,
  listTemplates,
  type NoteTemplateDeps,
  restoreTemplate,
  updateTemplate,
} from '../services/note-templates.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

const templateIdSchema = (what: string) => z.string().uuid().describe(`The ID of the template to ${what}`)

export const registerNoteTemplateTools = (
  server: McpServer,
  user: string,
  deps: NoteTemplateDeps = defaultNoteTemplateDeps,
) => {
  server.tool(
    'list_note_templates',
    `List the journal entry templates (a name and a markdown text a new entry starts from), by name. deleted: true lists the deleted ones that can still be restored, with deleted_at and purge_at (${DELETED_NOTE_RETENTION_DAYS} days after deletion).`,
    { deleted: z.boolean().optional().describe('true lists the deleted templates instead') },
    async ({ deleted }) =>
      jsonResponse({ data: await listTemplates(user, { deleted }, deps), success: true }),
  )

  server.tool(
    'add_note_template',
    'Add a journal entry template: a name and the markdown text a new entry starts from.',
    { ...addNoteTemplateBodySchema.shape },
    async ({ name, content }) => {
      const result = await addTemplate(user, { content, name }, deps)
      if (!result.ok) return errorResponse(result.error)
      return jsonResponse({ data: result.value, success: true })
    },
  )

  server.tool(
    'update_note_template',
    "Change a journal entry template's name or text.",
    { id: templateIdSchema('update'), ...updateNoteTemplateBodySchema.shape },
    async ({ id, name, content }) => {
      const result = await updateTemplate(user, id, { content, name }, deps)
      if (!result.ok) return errorResponse(result.error)
      return jsonResponse({ data: result.value, success: true })
    },
  )

  server.tool(
    'delete_note_template',
    `Delete a journal entry template. It can be restored with restore_note_template for ${DELETED_NOTE_RETENTION_DAYS} days; purge: true removes it for good at once.`,
    {
      id: templateIdSchema('delete'),
      purge: z.boolean().optional().describe('true removes the template for good at once'),
    },
    async ({ id, purge }) => {
      if (!(await deleteTemplate(user, id, { purge: purge === true }, deps))) {
        return errorResponse('Template not found')
      }
      return jsonResponse({ success: true })
    },
  )

  server.tool(
    'restore_note_template',
    'Restore a deleted journal entry template.',
    { id: templateIdSchema('restore') },
    async ({ id }) => {
      const result = await restoreTemplate(user, id, deps)
      if (!result.ok) return errorResponse(result.error)
      return jsonResponse({ data: result.value, success: true })
    },
  )
}
