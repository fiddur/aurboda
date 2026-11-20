import { randomUUID } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'

import type { NoteTemplateRecord } from '../db/index.ts'

import {
  addTemplate,
  deleteTemplate,
  listTemplates,
  type NoteTemplateDeps,
  restoreTemplate,
  updateTemplate,
} from './note-templates.ts'

const ID = randomUUID()

const record = (overrides: Partial<NoteTemplateRecord> = {}): NoteTemplateRecord => ({
  content: '## Mood\n\n## Gratitude',
  created_at: new Date('2026-11-01T08:00:00Z'),
  id: ID,
  name: 'Evening',
  updated_at: new Date('2026-11-01T08:00:00Z'),
  ...overrides,
})

const makeDeps = (overrides: Partial<NoteTemplateDeps> = {}): NoteTemplateDeps => ({
  insert: vi.fn(async (_user, t) => record(t)),
  list: vi.fn(async () => [record()]),
  purge: vi.fn(async () => true),
  restore: vi.fn(async () => record()),
  softDelete: vi.fn(async () => true),
  update: vi.fn(async (_user, _id, fields) => record(fields)),
  ...overrides,
})

describe('note templates', () => {
  test('adds one with its name trimmed', async () => {
    const deps = makeDeps()
    const result = await addTemplate('alice', { content: 'Today', name: '  Morning ' }, deps)
    expect(result).toMatchObject({ ok: true, value: { content: 'Today', name: 'Morning' } })
    expect(deps.insert).toHaveBeenCalledWith('alice', { content: 'Today', name: 'Morning' })
  })

  test('refuses an empty name or text, and an update with nothing in it', async () => {
    const deps = makeDeps()
    expect((await addTemplate('alice', { content: 'x', name: '  ' }, deps)).ok).toBe(false)
    expect((await addTemplate('alice', { content: '', name: 'n' }, deps)).ok).toBe(false)
    expect(await updateTemplate('alice', ID, {}, deps)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(deps.insert).not.toHaveBeenCalled()
    expect(deps.update).not.toHaveBeenCalled()
  })

  test('an update of a missing or deleted template is not found', async () => {
    const deps = makeDeps({ update: vi.fn(async () => null) })
    expect(await updateTemplate('alice', ID, { name: 'x' }, deps)).toMatchObject({
      ok: false,
      reason: 'not_found',
    })
    expect(await updateTemplate('alice', 'nope', { name: 'x' }, deps)).toMatchObject({ reason: 'not_found' })
  })

  test('lists the deleted ones with purge_at 30 days on', async () => {
    const deps = makeDeps({
      list: vi.fn(async () => [record({ deleted_at: new Date('2026-11-02T00:00:00Z') })]),
    })
    expect(await listTemplates('alice', { deleted: true }, deps)).toEqual([
      expect.objectContaining({
        deleted_at: '2026-11-02T00:00:00.000Z',
        purge_at: '2026-12-02T00:00:00.000Z',
      }),
    ])
    expect(deps.list).toHaveBeenCalledWith('alice', { deleted: true })
  })

  test('a delete is soft unless purged, and a restore brings it back', async () => {
    const deps = makeDeps()
    expect(await deleteTemplate('alice', ID, {}, deps)).toBe(true)
    expect(deps.softDelete).toHaveBeenCalledWith('alice', ID)
    expect(await deleteTemplate('alice', ID, { purge: true }, deps)).toBe(true)
    expect(deps.purge).toHaveBeenCalledWith('alice', ID)
    expect((await restoreTemplate('alice', ID, deps)).ok).toBe(true)
    const gone = makeDeps({ restore: vi.fn(async () => null) })
    expect(await restoreTemplate('alice', ID, gone)).toMatchObject({ ok: false, reason: 'not_found' })
  })
})
