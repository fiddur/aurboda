import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  insertNoteTemplate,
  listNoteTemplates,
  purgeNoteTemplate,
  restoreNoteTemplate,
  softDeleteNoteTemplate,
  updateNoteTemplate,
} from './note-templates.ts'

const CONTAINER_TIMEOUT = 120_000

describe('Note templates integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('insertNoteTemplate stores a template', async () => {
    const user = getTestUser()
    expect(await insertNoteTemplate(user, { content: '## Mood', name: 'Evening' })).toEqual({
      content: '## Mood',
      created_at: expect.any(Date),
      deleted_at: undefined,
      id: expect.any(String),
      name: 'Evening',
      updated_at: expect.any(Date),
    })
  })

  test('listNoteTemplates lists the live ones by name, or the deleted ones', async () => {
    const user = getTestUser()
    const zeta = await insertNoteTemplate(user, { content: 'z', name: 'zeta' })
    await insertNoteTemplate(user, { content: 'a', name: 'Alpha' })
    await softDeleteNoteTemplate(user, zeta.id)
    await insertNoteTemplate(user, { content: 'b', name: 'beta' })

    expect((await listNoteTemplates(user)).map((t) => t.name)).toEqual(['Alpha', 'beta'])
    const deleted = await listNoteTemplates(user, { deleted: true })
    expect(deleted.map((t) => t.id)).toEqual([zeta.id])
    expect(deleted[0].deleted_at).toBeInstanceOf(Date)
  })

  test('updateNoteTemplate changes the given fields of a live template', async () => {
    const user = getTestUser()
    const template = await insertNoteTemplate(user, { content: 'old', name: 'Evening' })
    const renamed = await updateNoteTemplate(user, template.id, { name: 'Night' })
    expect(renamed).toMatchObject({ content: 'old', name: 'Night' })
    expect(renamed!.updated_at.getTime()).toBeGreaterThanOrEqual(template.updated_at.getTime())
    expect(await updateNoteTemplate(user, template.id, { content: 'new' })).toMatchObject({
      content: 'new',
      name: 'Night',
    })

    await softDeleteNoteTemplate(user, template.id)
    expect(await updateNoteTemplate(user, template.id, { name: 'x' })).toBeNull()
  })

  test('soft delete, restore and purge', async () => {
    const user = getTestUser()
    const template = await insertNoteTemplate(user, { content: 'x', name: 'Evening' })
    expect(await softDeleteNoteTemplate(user, template.id)).toBe(true)
    expect(await softDeleteNoteTemplate(user, template.id)).toBe(false)
    expect(await restoreNoteTemplate(user, template.id)).toMatchObject({
      deleted_at: undefined,
      id: template.id,
    })
    expect(await purgeNoteTemplate(user, template.id)).toBe(true)
    expect(await purgeNoteTemplate(user, template.id)).toBe(false)
    expect(await restoreNoteTemplate(user, template.id)).toBeNull()
  })
})
