import {
  DELETED_NOTE_RETENTION_DAYS,
  NOTE_TEMPLATE_CONTENT_MAX_LENGTH,
  NOTE_TEMPLATE_NAME_MAX_LENGTH,
  type NoteTemplate,
} from '@aurboda/api-spec'

import {
  insertNoteTemplate,
  listNoteTemplates,
  type NoteTemplateRecord,
  purgeNoteTemplate,
  restoreNoteTemplate,
  softDeleteNoteTemplate,
  updateNoteTemplate,
} from '../db/index.ts'
import { UUID_RE } from '../utils.ts'

const DAY_MS = 24 * 60 * 60 * 1000

export const toNoteTemplateData = (record: NoteTemplateRecord): NoteTemplate => ({
  content: record.content,
  created_at: record.created_at.toISOString(),
  deleted_at: record.deleted_at?.toISOString(),
  id: record.id,
  name: record.name,
  purge_at: record.deleted_at
    ? new Date(record.deleted_at.getTime() + DELETED_NOTE_RETENTION_DAYS * DAY_MS).toISOString()
    : undefined,
  updated_at: record.updated_at.toISOString(),
})

export interface NoteTemplateDeps {
  insert: (user: string, template: { name: string; content: string }) => Promise<NoteTemplateRecord>
  list: (user: string, options: { deleted?: boolean }) => Promise<NoteTemplateRecord[]>
  update: (
    user: string,
    id: string,
    fields: { name?: string; content?: string },
  ) => Promise<NoteTemplateRecord | null>
  softDelete: (user: string, id: string) => Promise<boolean>
  purge: (user: string, id: string) => Promise<boolean>
  restore: (user: string, id: string) => Promise<NoteTemplateRecord | null>
}

export const defaultNoteTemplateDeps: NoteTemplateDeps = {
  insert: (user, template) => insertNoteTemplate(user, template),
  list: (user, options) => listNoteTemplates(user, options),
  purge: (user, id) => purgeNoteTemplate(user, id),
  restore: (user, id) => restoreNoteTemplate(user, id),
  softDelete: (user, id) => softDeleteNoteTemplate(user, id),
  update: (user, id, fields) => updateNoteTemplate(user, id, fields),
}

export type NoteTemplateResult =
  | { ok: true; value: NoteTemplate }
  | { ok: false; reason: 'not_found' | 'invalid'; error: string }

const NOT_FOUND: NoteTemplateResult = { error: 'Template not found', ok: false, reason: 'not_found' }

const invalid = (error: string): NoteTemplateResult => ({ error, ok: false, reason: 'invalid' })

/** Why a name or content is refused, if it is; the name as stored otherwise. */
const checkFields = (fields: {
  name?: string
  content?: string
}): string | { name?: string; content?: string } => {
  const name = fields.name?.trim()
  if (name !== undefined && (name.length === 0 || name.length > NOTE_TEMPLATE_NAME_MAX_LENGTH)) {
    return `name must be 1 to ${NOTE_TEMPLATE_NAME_MAX_LENGTH} characters`
  }
  const { content } = fields
  if (content !== undefined && (content.length === 0 || content.length > NOTE_TEMPLATE_CONTENT_MAX_LENGTH)) {
    return `content must be 1 to ${NOTE_TEMPLATE_CONTENT_MAX_LENGTH} characters`
  }
  return { content, name }
}

/** The live templates by name, or with `deleted` the ones that can still be restored. */
export const listTemplates = async (
  user: string,
  options: { deleted?: boolean } = {},
  deps: NoteTemplateDeps = defaultNoteTemplateDeps,
): Promise<NoteTemplate[]> =>
  (await deps.list(user, { deleted: options.deleted === true })).map(toNoteTemplateData)

export const addTemplate = async (
  user: string,
  input: { name: string; content: string },
  deps: NoteTemplateDeps = defaultNoteTemplateDeps,
): Promise<NoteTemplateResult> => {
  const checked = checkFields(input)
  if (typeof checked === 'string') return invalid(checked)
  const record = await deps.insert(user, { content: input.content, name: checked.name! })
  return { ok: true, value: toNoteTemplateData(record) }
}

export const updateTemplate = async (
  user: string,
  id: string,
  fields: { name?: string; content?: string },
  deps: NoteTemplateDeps = defaultNoteTemplateDeps,
): Promise<NoteTemplateResult> => {
  if (!UUID_RE.test(id)) return NOT_FOUND
  if (fields.name === undefined && fields.content === undefined) {
    return invalid('At least one of name or content must be provided')
  }
  const checked = checkFields(fields)
  if (typeof checked === 'string') return invalid(checked)
  const record = await deps.update(user, id, checked)
  return record ? { ok: true, value: toNoteTemplateData(record) } : NOT_FOUND
}

/** Restorable for DELETED_NOTE_RETENTION_DAYS; `purge` removes it for good at once. */
export const deleteTemplate = async (
  user: string,
  id: string,
  options: { purge?: boolean } = {},
  deps: NoteTemplateDeps = defaultNoteTemplateDeps,
): Promise<boolean> => {
  if (!UUID_RE.test(id)) return false
  return options.purge ? deps.purge(user, id) : deps.softDelete(user, id)
}

export const restoreTemplate = async (
  user: string,
  id: string,
  deps: NoteTemplateDeps = defaultNoteTemplateDeps,
): Promise<NoteTemplateResult> => {
  if (!UUID_RE.test(id)) return NOT_FOUND
  const record = await deps.restore(user, id)
  return record ? { ok: true, value: toNoteTemplateData(record) } : NOT_FOUND
}
