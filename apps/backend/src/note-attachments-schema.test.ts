import {
  addNoteAttachmentInputSchema,
  addNoteTemplateBodySchema,
  MAX_ATTACHMENTS_PER_NOTE,
  NOTE_ATTACHMENT_MAX_BYTES,
  NOTE_ATTACHMENT_MCP_MAX_BYTES,
  NOTE_ATTACHMENTS_ACCOUNT_BYTES,
  NOTE_IMAGE_MAX_EDGE,
  NOTE_TEMPLATE_CONTENT_MAX_LENGTH,
  NOTE_TEMPLATE_NAME_MAX_LENGTH,
  noteAttachmentContentQuerySchema,
  noteAttachmentsQuerySchema,
  notesQueryRangeSchema,
  notesSearchQuerySchema,
  updateNoteTemplateBodySchema,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

const ok = (result: { success: boolean }) => expect(result.success).toBe(true)
const refused = (result: { success: boolean }) => expect(result.success).toBe(false)

const NOTE_ID = '9d0124e7-d161-4855-a54f-fa8bdb45c4f2'

describe('note attachment limits', () => {
  test('are the agreed sizes', () => {
    expect(NOTE_ATTACHMENT_MAX_BYTES).toBe(20 * 1024 * 1024)
    expect(MAX_ATTACHMENTS_PER_NOTE).toBe(30)
    expect(NOTE_ATTACHMENTS_ACCOUNT_BYTES).toBe(2 * 1024 * 1024 * 1024)
    expect(NOTE_IMAGE_MAX_EDGE).toBe(3000)
    expect(NOTE_ATTACHMENT_MCP_MAX_BYTES).toBe(5 * 1024 * 1024)
  })
})

describe('noteAttachmentContentQuerySchema', () => {
  test('takes max_edge 400 or 2000 and nothing else', () => {
    ok(noteAttachmentContentQuerySchema.safeParse({}))
    ok(noteAttachmentContentQuerySchema.safeParse({ max_edge: '400' }))
    ok(noteAttachmentContentQuerySchema.safeParse({ max_edge: '2000' }))
    refused(noteAttachmentContentQuerySchema.safeParse({ max_edge: '800' }))
    refused(noteAttachmentContentQuerySchema.safeParse({ max_edge: 'big' }))
  })
})

describe('noteAttachmentsQuerySchema', () => {
  test('reads deleted as a query boolean', () => {
    expect(noteAttachmentsQuerySchema.parse({ deleted: 'true' })).toEqual({ deleted: true })
    expect(noteAttachmentsQuerySchema.parse({})).toEqual({})
  })
})

describe('addNoteAttachmentInputSchema', () => {
  test('needs a note id and base64 data within the MCP limit', () => {
    ok(addNoteAttachmentInputSchema.safeParse({ data: 'cG5n', filename: 'page1.jpg', note_id: NOTE_ID }))
    refused(addNoteAttachmentInputSchema.safeParse({ data: 'cG5n', note_id: 'nope' }))
    refused(addNoteAttachmentInputSchema.safeParse({ data: '', note_id: NOTE_ID }))
    refused(
      addNoteAttachmentInputSchema.safeParse({
        data: 'A'.repeat(Math.ceil(NOTE_ATTACHMENT_MCP_MAX_BYTES / 3) * 4 + 4),
        note_id: NOTE_ID,
      }),
    )
  })
})

describe('needs_text', () => {
  test('is a query boolean on the search and the range read', () => {
    expect(notesSearchQuerySchema.parse({ needs_text: 'true' }).needs_text).toBe(true)
    expect(notesSearchQuerySchema.parse({ needs_text: true }).needs_text).toBe(true)
    expect(
      notesQueryRangeSchema.parse({
        from: '2024-01-01T00:00:00Z',
        needs_text: '1',
        to: '2024-01-02T00:00:00Z',
      }).needs_text,
    ).toBe(true)
  })
})

describe('note template bodies', () => {
  test('a name is trimmed and 1 to 120 characters; content 1 to 20 000', () => {
    expect(addNoteTemplateBodySchema.parse({ content: '## Mood', name: '  Evening  ' })).toEqual({
      content: '## Mood',
      name: 'Evening',
    })
    refused(addNoteTemplateBodySchema.safeParse({ content: 'x', name: '   ' }))
    refused(
      addNoteTemplateBodySchema.safeParse({
        content: 'x',
        name: 'n'.repeat(NOTE_TEMPLATE_NAME_MAX_LENGTH + 1),
      }),
    )
    ok(addNoteTemplateBodySchema.safeParse({ content: 'x', name: 'n'.repeat(NOTE_TEMPLATE_NAME_MAX_LENGTH) }))
    refused(addNoteTemplateBodySchema.safeParse({ content: '', name: 'Evening' }))
    ok(
      addNoteTemplateBodySchema.safeParse({
        content: 'c'.repeat(NOTE_TEMPLATE_CONTENT_MAX_LENGTH),
        name: 'n',
      }),
    )
    refused(
      addNoteTemplateBodySchema.safeParse({
        content: 'c'.repeat(NOTE_TEMPLATE_CONTENT_MAX_LENGTH + 1),
        name: 'n',
      }),
    )
  })

  test('an update needs at least one field', () => {
    refused(updateNoteTemplateBodySchema.safeParse({}))
    ok(updateNoteTemplateBodySchema.safeParse({ name: 'Morning' }))
    ok(updateNoteTemplateBodySchema.safeParse({ content: 'Today' }))
    refused(updateNoteTemplateBodySchema.safeParse({ name: '' }))
  })
})
