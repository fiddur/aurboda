import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { deleteIcon, getIcon, insertIcon } from './icons.ts'

const CONTAINER_TIMEOUT = 120_000

describe('Icons Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('insertIcon', () => {
    test('inserts an icon and returns a UUID', async () => {
      const user = getTestUser()
      const data = Buffer.from('fake-png-data')

      const id = await insertIcon(user, 'image/png', data)

      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })
  })

  describe('getIcon', () => {
    test('retrieves an inserted icon', async () => {
      const user = getTestUser()
      const data = Buffer.from('fake-svg-data')

      const id = await insertIcon(user, 'image/svg+xml', data)
      const icon = await getIcon(user, id)

      expect(icon).toBeDefined()
      expect(icon!.content_type).toBe('image/svg+xml')
      expect(icon!.data).toEqual(data)
    })

    test('returns undefined for non-existent icon', async () => {
      const user = getTestUser()
      const icon = await getIcon(user, '00000000-0000-0000-0000-000000000000')
      expect(icon).toBeUndefined()
    })
  })

  describe('deleteIcon', () => {
    test('deletes an existing icon', async () => {
      const user = getTestUser()
      const id = await insertIcon(user, 'image/png', Buffer.from('data'))

      const deleted = await deleteIcon(user, id)
      expect(deleted).toBe(true)

      const icon = await getIcon(user, id)
      expect(icon).toBeUndefined()
    })

    test('returns false for non-existent icon', async () => {
      const user = getTestUser()
      const deleted = await deleteIcon(user, '00000000-0000-0000-0000-000000000000')
      expect(deleted).toBe(false)
    })
  })
})
