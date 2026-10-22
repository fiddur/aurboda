import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { deleteOAuthToken, getOAuthToken, upsertOAuthToken } from './oauth.ts'

const CONTAINER_TIMEOUT = 120_000

describe('OAuth token Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('deleteOAuthToken', () => {
    test('removes the provider row so getOAuthToken returns null', async () => {
      const user = getTestUser()
      await upsertOAuthToken(user, { access_token: 'oura-token', provider: 'oura', refresh_token: 'refresh' })

      expect(await deleteOAuthToken(user, 'oura')).toBe(true)
      expect(await getOAuthToken(user, 'oura')).toBeNull()
    })

    test('returns false when there is no row to delete', async () => {
      const user = getTestUser()
      await upsertOAuthToken(user, { access_token: 'oura-token', provider: 'oura' })

      await deleteOAuthToken(user, 'oura')
      expect(await deleteOAuthToken(user, 'oura')).toBe(false)
    })

    test("leaves another provider's row untouched", async () => {
      const user = getTestUser()
      await upsertOAuthToken(user, { access_token: 'oura-token', provider: 'oura' })
      await upsertOAuthToken(user, { access_token: 'strava-token', provider: 'strava' })

      await deleteOAuthToken(user, 'oura')

      const strava = await getOAuthToken(user, 'strava')
      expect(strava?.access_token).toBe('strava-token')
    })
  })
})
