import { randomUUID } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'

import type { NoteTemplateRecord } from '../db/index.ts'
import type { NoteTemplateDeps } from '../services/note-templates.ts'
import type { McpServer } from './helpers.ts'

import { registerNoteTemplateTools } from './note-template-tools.ts'

type ToolHandler = (
  params: Record<string, unknown>,
) => Promise<{ content: { text: string }[]; isError?: boolean }>

const ID = randomUUID()

const record = (overrides: Partial<NoteTemplateRecord> = {}): NoteTemplateRecord => ({
  content: '## Mood',
  created_at: new Date('2026-11-01T08:00:00Z'),
  id: ID,
  name: 'Evening',
  updated_at: new Date('2026-11-01T08:00:00Z'),
  ...overrides,
})

const setup = (overrides: Partial<NoteTemplateDeps> = {}) => {
  const deps: NoteTemplateDeps = {
    insert: vi.fn(async (_user, t) => record(t)),
    list: vi.fn(async () => [record()]),
    purge: vi.fn(async () => true),
    restore: vi.fn(async () => record()),
    softDelete: vi.fn(async () => true),
    update: vi.fn(async (_user, _id, fields) => record(fields)),
    ...overrides,
  }
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _description: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  registerNoteTemplateTools(server, 'alice', deps)
  const call = (name: string, params: Record<string, unknown> = {}) => tools.get(name)!(params)
  return { call, deps, tools }
}

const body = (result: { content: { text: string }[] }) => JSON.parse(result.content[0].text)

describe('note template tools', () => {
  test('registers the five tools', () => {
    expect([...setup().tools.keys()].sort()).toEqual([
      'add_note_template',
      'delete_note_template',
      'list_note_templates',
      'restore_note_template',
      'update_note_template',
    ])
  })

  test('list, add and update', async () => {
    const { call, deps } = setup()
    expect(body(await call('list_note_templates')).data[0].name).toBe('Evening')
    await call('list_note_templates', { deleted: true })
    expect(deps.list).toHaveBeenLastCalledWith('alice', { deleted: true })
    expect(body(await call('add_note_template', { content: 'Today', name: 'Morning' })).data.name).toBe(
      'Morning',
    )
    expect(body(await call('update_note_template', { id: ID, name: 'Night' })).data.name).toBe('Night')
  })

  test('delete softly or for good, restore, and say when it is not there', async () => {
    const { call, deps } = setup()
    await call('delete_note_template', { id: ID })
    expect(deps.softDelete).toHaveBeenCalledWith('alice', ID)
    await call('delete_note_template', { id: ID, purge: true })
    expect(deps.purge).toHaveBeenCalledWith('alice', ID)
    expect(body(await call('restore_note_template', { id: ID })).success).toBe(true)

    const missing = setup({ restore: vi.fn(async () => null), softDelete: vi.fn(async () => false) })
    expect((await missing.call('delete_note_template', { id: ID })).isError).toBe(true)
    expect((await missing.call('restore_note_template', { id: ID })).content[0].text).toBe(
      'Template not found',
    )
  })
})
