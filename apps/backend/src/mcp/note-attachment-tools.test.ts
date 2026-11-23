import { NOTE_ATTACHMENT_MCP_MAX_BYTES } from '@aurboda/api-spec'
import { randomUUID } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'

import type { NoteAttachmentRecord } from '../db/index.ts'
import type { Note } from '../db/types.ts'
import type { NoteAttachmentDeps } from '../services/note-attachments.ts'
import type { McpServer } from './helpers.ts'

import { createTokenBucketLimiter } from '../services/rate-limit.ts'
import { registerNoteAttachmentTools } from './note-attachment-tools.ts'

interface ToolContent {
  type: string
  text?: string
  data?: string
  mimeType?: string
}

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: ToolContent[]; isError?: boolean }>

const NOTE_ID = randomUUID()
const ATTACHMENT_ID = randomUUID()

const entry: Note = {
  content: '',
  created_at: new Date('2026-11-01T08:00:00Z'),
  date: '2026-11-01',
  entity_id: null,
  entity_type: 'day',
  id: NOTE_ID,
  updated_at: new Date('2026-11-01T08:00:00Z'),
}

const record = (overrides: Partial<NoteAttachmentRecord> = {}): NoteAttachmentRecord => ({
  created_at: new Date('2026-11-01T08:00:00Z'),
  height: 2000,
  id: ATTACHMENT_ID,
  kind: 'image',
  mime: 'image/webp',
  note_id: NOTE_ID,
  position: 1,
  size: 100,
  width: 1500,
  ...overrides,
})

const makeDeps = (overrides: Partial<NoteAttachmentDeps> = {}): NoteAttachmentDeps => ({
  getAttachment: vi.fn(async () => record()),
  getBytes: vi.fn(async () => ({ bytes: Buffer.from('webp'), kind: 'image', mime: 'image/webp' })),
  getNoteById: vi.fn(async () => entry),
  getStripMetadata: vi.fn(async () => false),
  getUsage: vi.fn(async () => ({ account_bytes: 0, live_count: 0, max_position: null })),
  insert: vi.fn(async (_u, _n, a) => ({
    ok: true as const,
    value: record({ kind: a.kind, mime: a.mime, size: a.bytes.length }),
  })),
  listDeleted: vi.fn(async () => [record({ deleted_at: new Date('2026-11-02T08:00:00Z') })]),
  listLive: vi.fn(async () => new Map()),
  process: vi.fn(async (bytes: Buffer) => ({ bytes, kind: 'audio' as const, mime: 'audio/ogg' })),
  purge: vi.fn(async () => true),
  resize: vi.fn(async () => Buffer.from('small')),
  restore: vi.fn(async () => ({ ok: true as const, value: record() })),
  softDelete: vi.fn(async () => true),
  toAssistantImage: vi.fn(async () => Buffer.from('jpeg-bytes')),
  ...overrides,
})

const setup = (
  attachments: NoteAttachmentDeps = makeDeps(),
  uploadLimiter?: ReturnType<typeof createTokenBucketLimiter>,
) => {
  const tools = new Map<string, { description: string; handler: ToolHandler }>()
  const server = {
    tool: (name: string, description: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, { description, handler })
    },
  } as unknown as McpServer
  registerNoteAttachmentTools(server, 'alice', { attachments, uploadLimiter })
  const call = (name: string, params: Record<string, unknown> = {}) => tools.get(name)!.handler(params)
  return { attachments, call, tools }
}

describe('note attachment tools', () => {
  test('registers the five tools, describing the diary transcription flow', () => {
    const { tools } = setup()
    expect([...tools.keys()].sort()).toEqual([
      'add_note_attachment',
      'delete_note_attachment',
      'get_note_attachment',
      'list_deleted_note_attachments',
      'restore_note_attachment',
    ])
    expect(tools.get('get_note_attachment')!.description).toContain('needs_text: true')
    expect(tools.get('add_note_attachment')!.description).toContain('4 MB')
    expect(tools.get('add_note_attachment')?.description).toContain('](attachment:<attachment id>)')
  })

  test('add_note_attachment stores the decoded file', async () => {
    const { attachments, call } = setup()
    const result = await call('add_note_attachment', {
      data: Buffer.from('OggS-bytes').toString('base64'),
      filename: 'memo.ogg',
      note_id: NOTE_ID,
    })
    expect(JSON.parse(result.content[0].text!).data).toMatchObject({
      kind: 'audio',
      mime: 'audio/ogg',
      position: 1,
    })
    expect(attachments.process).toHaveBeenCalledWith(Buffer.from('OggS-bytes'), { stripMetadata: false })
  })

  test('add_note_attachment refuses a file over the MCP limit, a non-entry and the upload budget', async () => {
    const { attachments, call } = setup()
    const big = await call('add_note_attachment', {
      data: Buffer.alloc(NOTE_ATTACHMENT_MCP_MAX_BYTES + 1).toString('base64'),
      note_id: NOTE_ID,
    })
    expect(big.isError).toBe(true)
    expect(attachments.process).not.toHaveBeenCalled()

    const onActivity = setup(
      makeDeps({ getNoteById: vi.fn(async () => ({ ...entry, entity_type: 'activity' as const })) }),
    )
    const refused = await onActivity.call('add_note_attachment', { data: 'cG5n', note_id: NOTE_ID })
    expect(refused.content[0].text).toBe('Pictures and recordings can only be added to a journal entry.')

    const limiter = createTokenBucketLimiter({ capacity: 1, refill_per_second: 0 }, () => 0)
    const limited = setup(makeDeps(), limiter)
    expect(
      (await limited.call('add_note_attachment', { data: 'cG5n', note_id: NOTE_ID })).isError,
    ).toBeUndefined()
    expect((await limited.call('add_note_attachment', { data: 'cG5n', note_id: NOTE_ID })).isError).toBe(true)
  })

  test('get_note_attachment answers a picture as MCP image content with its metadata', async () => {
    const { call } = setup()
    const result = await call('get_note_attachment', { attachment_id: ATTACHMENT_ID, note_id: NOTE_ID })
    expect(result.content[0]).toEqual({
      data: Buffer.from('jpeg-bytes').toString('base64'),
      mimeType: 'image/jpeg',
      type: 'image',
    })
    expect(JSON.parse(result.content[1].text!).data).toMatchObject({ id: ATTACHMENT_ID, position: 1 })
  })

  test('get_note_attachment answers a recording as its metadata only', async () => {
    const { call } = setup(
      makeDeps({ getAttachment: vi.fn(async () => record({ kind: 'audio', mime: 'audio/webm' })) }),
    )
    const result = await call('get_note_attachment', { attachment_id: ATTACHMENT_ID, note_id: NOTE_ID })
    expect(result.content).toHaveLength(1)
    const body = JSON.parse(result.content[0].text!)
    expect(body.data.mime).toBe('audio/webm')
    expect(body.message).toContain('played in the app')
  })

  test('delete, restore and list the deleted ones', async () => {
    const { attachments, call } = setup()
    await call('delete_note_attachment', { attachment_id: ATTACHMENT_ID, note_id: NOTE_ID })
    expect(attachments.softDelete).toHaveBeenCalledWith('alice', NOTE_ID, ATTACHMENT_ID)
    await call('delete_note_attachment', { attachment_id: ATTACHMENT_ID, note_id: NOTE_ID, purge: true })
    expect(attachments.purge).toHaveBeenCalledWith('alice', NOTE_ID, ATTACHMENT_ID)

    const restored = await call('restore_note_attachment', { attachment_id: ATTACHMENT_ID, note_id: NOTE_ID })
    expect(JSON.parse(restored.content[0].text!).success).toBe(true)

    const listed = await call('list_deleted_note_attachments', { note_id: NOTE_ID })
    expect(JSON.parse(listed.content[0].text!).data[0]).toMatchObject({
      purge_at: '2026-12-02T08:00:00.000Z',
    })

    const gone = setup(makeDeps({ softDelete: vi.fn(async () => false) }))
    expect(
      (await gone.call('delete_note_attachment', { attachment_id: ATTACHMENT_ID, note_id: NOTE_ID })).isError,
    ).toBe(true)
  })
})
