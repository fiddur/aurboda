import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  deleteOAuthToken,
  getOAuthToken,
  markOAuthTokenRefused,
  updateOAuthAccessToken,
  updateOAuthTokenScopes,
  upsertOAuthToken,
} from './oauth.ts'

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

  describe('updateOAuthTokenScopes', () => {
    test('replaces the scopes and keeps the tokens', async () => {
      const user = getTestUser()
      await upsertOAuthToken(user, {
        access_token: 'garmin-access',
        provider: 'garmin_oauth',
        refresh_token: 'garmin-refresh',
        scopes: ['HEALTH_EXPORT'],
      })

      expect(await updateOAuthTokenScopes(user, 'garmin_oauth', ['ACTIVITY_EXPORT', 'MCT_EXPORT'])).toBe(true)
      const token = await getOAuthToken(user, 'garmin_oauth')
      expect(token?.scopes).toEqual(['ACTIVITY_EXPORT', 'MCT_EXPORT'])
      expect(token?.access_token).toBe('garmin-access')
      expect(token?.refresh_token).toBe('garmin-refresh')
    })

    test('stores an empty list', async () => {
      const user = getTestUser()
      await upsertOAuthToken(user, {
        access_token: 'garmin-access',
        provider: 'garmin_oauth',
        scopes: ['HEALTH_EXPORT'],
      })

      await updateOAuthTokenScopes(user, 'garmin_oauth', [])
      expect((await getOAuthToken(user, 'garmin_oauth'))?.scopes).toEqual([])
    })

    test('answers false and creates nothing without a row', async () => {
      const user = getTestUser()

      expect(await updateOAuthTokenScopes(user, 'garmin_oauth', ['HEALTH_EXPORT'])).toBe(false)
      expect(await getOAuthToken(user, 'garmin_oauth')).toBeNull()
    })
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

  describe('upsertOAuthToken and getOAuthToken', () => {
    test('round-trips every field, with no refusal on a fresh row', async () => {
      const user = getTestUser()
      const expiresAt = new Date('2027-06-30T00:00:00Z')
      await upsertOAuthToken(user, {
        access_token: 'jwt',
        expires_at: expiresAt,
        provider: 'garmin_personal',
        refresh_token: 'fake-key',
      })

      expect(await getOAuthToken(user, 'garmin_personal')).toEqual({
        access_token: 'jwt',
        expires_at: expiresAt,
        provider: 'garmin_personal',
        refresh_token: 'fake-key',
        refused_at: undefined,
        scopes: null,
        updated_at: expect.any(Date),
      })
    })
  })

  describe('markOAuthTokenRefused', () => {
    test('sets refused_at on that provider only', async () => {
      const user = getTestUser()
      await upsertOAuthToken(user, {
        access_token: '',
        provider: 'garmin_personal',
        refresh_token: 'fake-key',
      })
      await upsertOAuthToken(user, { access_token: 'session', provider: 'garmin' })

      await markOAuthTokenRefused(user, 'garmin_personal')

      expect((await getOAuthToken(user, 'garmin_personal'))?.refused_at).toBeInstanceOf(Date)
      expect((await getOAuthToken(user, 'garmin'))?.refused_at).toBeUndefined()
    })

    test('does nothing when there is no row', async () => {
      const user = getTestUser()
      await markOAuthTokenRefused(user, 'garmin_personal')
      expect(await getOAuthToken(user, 'garmin_personal')).toBeNull()
    })

    test('a later upsert clears the refusal', async () => {
      const user = getTestUser()
      await upsertOAuthToken(user, {
        access_token: '',
        provider: 'garmin_personal',
        refresh_token: 'fake-key',
      })
      await markOAuthTokenRefused(user, 'garmin_personal')

      await upsertOAuthToken(user, {
        access_token: '',
        provider: 'garmin_personal',
        refresh_token: 'fake-key-2',
      })

      const stored = await getOAuthToken(user, 'garmin_personal')
      expect(stored?.refused_at).toBeUndefined()
      expect(stored?.refresh_token).toBe('fake-key-2')
    })

    test('a repeated refusal keeps the first refused_at and moves updated_at', async () => {
      const user = getTestUser()
      await upsertOAuthToken(user, {
        access_token: '',
        provider: 'garmin_personal',
        refresh_token: 'fake-key',
      })
      await markOAuthTokenRefused(user, 'garmin_personal', 'fake-key')
      const first = await getOAuthToken(user, 'garmin_personal')
      await new Promise((resolve) => setTimeout(resolve, 20))

      await markOAuthTokenRefused(user, 'garmin_personal', 'fake-key')

      const again = await getOAuthToken(user, 'garmin_personal')
      expect(again?.refused_at).toEqual(first?.refused_at)
      expect(again!.updated_at!.getTime()).toBeGreaterThan(first!.updated_at!.getTime())
    })

    test('with a refresh token, marks the row only while it still holds that token', async () => {
      const user = getTestUser()
      await upsertOAuthToken(user, {
        access_token: '',
        provider: 'garmin_personal',
        refresh_token: 'fake-key-2',
      })

      await markOAuthTokenRefused(user, 'garmin_personal', 'fake-key-1')
      expect((await getOAuthToken(user, 'garmin_personal'))?.refused_at).toBeUndefined()

      await markOAuthTokenRefused(user, 'garmin_personal', 'fake-key-2')
      expect((await getOAuthToken(user, 'garmin_personal'))?.refused_at).toBeInstanceOf(Date)
    })
  })

  describe('updateOAuthAccessToken', () => {
    const expiresAt = new Date('2027-06-30T00:00:00Z')

    test('stores the access token and keeps the key and its expiry', async () => {
      const user = getTestUser()
      await upsertOAuthToken(user, {
        access_token: 'old-jwt',
        expires_at: expiresAt,
        provider: 'garmin_personal',
        refresh_token: 'fake-key',
      })

      expect(await updateOAuthAccessToken(user, 'garmin_personal', 'fake-key', 'new-jwt')).toBe(true)

      expect(await getOAuthToken(user, 'garmin_personal')).toMatchObject({
        access_token: 'new-jwt',
        expires_at: expiresAt,
        refresh_token: 'fake-key',
        refused_at: undefined,
      })
    })

    test('a successful exchange clears an earlier refusal', async () => {
      const user = getTestUser()
      await upsertOAuthToken(user, {
        access_token: '',
        provider: 'garmin_personal',
        refresh_token: 'fake-key',
      })
      await markOAuthTokenRefused(user, 'garmin_personal', 'fake-key')

      expect(await updateOAuthAccessToken(user, 'garmin_personal', 'fake-key', 'new-jwt')).toBe(true)

      expect((await getOAuthToken(user, 'garmin_personal'))?.refused_at).toBeUndefined()
    })

    test('a stale key changes nothing', async () => {
      const user = getTestUser()
      await upsertOAuthToken(user, {
        access_token: 'jwt-for-new-key',
        expires_at: expiresAt,
        provider: 'garmin_personal',
        refresh_token: 'fake-key-new',
      })

      expect(await updateOAuthAccessToken(user, 'garmin_personal', 'fake-key-old', 'jwt-for-old-key')).toBe(
        false,
      )

      expect(await getOAuthToken(user, 'garmin_personal')).toMatchObject({
        access_token: 'jwt-for-new-key',
        refresh_token: 'fake-key-new',
      })
    })

    test('does nothing when there is no row', async () => {
      const user = getTestUser()
      expect(await updateOAuthAccessToken(user, 'garmin_personal', 'fake-key', 'jwt')).toBe(false)
      expect(await getOAuthToken(user, 'garmin_personal')).toBeNull()
    })
  })
})
