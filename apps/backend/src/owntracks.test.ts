import express, { json } from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createOwnTracksRouter, type OwnTracksDeps, parseBasicAuth } from './owntracks.ts'

describe('parseBasicAuth', () => {
  test('parses valid Basic auth header', () => {
    const encoded = Buffer.from('testuser:testpass').toString('base64')
    const result = parseBasicAuth(`Basic ${encoded}`)
    expect(result).toEqual({ password: 'testpass', username: 'testuser' })
  })

  test('returns undefined for missing header', () => {
    expect(parseBasicAuth(undefined)).toBeUndefined()
  })

  test('returns undefined for empty header', () => {
    expect(parseBasicAuth('')).toBeUndefined()
  })

  test('returns undefined for non-Basic auth', () => {
    expect(parseBasicAuth('Bearer token123')).toBeUndefined()
  })

  test('returns undefined for invalid base64', () => {
    expect(parseBasicAuth('Basic !!!invalid!!!')).toBeUndefined()
  })

  test('returns undefined for missing colon in decoded value', () => {
    const encoded = Buffer.from('nocolon').toString('base64')
    expect(parseBasicAuth(`Basic ${encoded}`)).toBeUndefined()
  })

  test('handles password with colons', () => {
    const encoded = Buffer.from('user:pass:with:colons').toString('base64')
    const result = parseBasicAuth(`Basic ${encoded}`)
    expect(result).toEqual({ password: 'pass:with:colons', username: 'user' })
  })

  test('handles empty password', () => {
    const encoded = Buffer.from('user:').toString('base64')
    const result = parseBasicAuth(`Basic ${encoded}`)
    expect(result).toEqual({ password: '', username: 'user' })
  })

  test('handles special characters in credentials', () => {
    const encoded = Buffer.from('user@domain.com:p@$$w0rd!').toString('base64')
    const result = parseBasicAuth(`Basic ${encoded}`)
    expect(result).toEqual({
      password: 'p@$$w0rd!',
      username: 'user@domain.com',
    })
  })

  test('handles case-insensitive Basic prefix', () => {
    const encoded = Buffer.from('user:pass').toString('base64')
    expect(parseBasicAuth(`basic ${encoded}`)).toEqual({
      password: 'pass',
      username: 'user',
    })
    expect(parseBasicAuth(`BASIC ${encoded}`)).toEqual({
      password: 'pass',
      username: 'user',
    })
  })
})

describe('OwnTracks Router', () => {
  const mockDeps: OwnTracksDeps = {
    insertLocation: vi.fn(),
    insertPlace: vi.fn(),
    loginToUserDb: vi.fn(),
  }

  function createTestApp() {
    const app = express()
    app.use(json())
    app.use('/ownTracks', createOwnTracksRouter(mockDeps))
    return app
  }

  function basicAuth(username: string, password: string): string {
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Authentication', () => {
    test('returns 401 without authorization header', async () => {
      const app = createTestApp()
      const response = await request(app).post('/ownTracks').send({ _type: 'location' })

      expect(response.status).toBe(401)
      expect(response.body.error).toBe('Unauthorized')
      expect(response.headers['www-authenticate']).toBe('Basic realm="OwnTracks"')
    })

    test('returns 401 with Bearer token instead of Basic', async () => {
      const app = createTestApp()
      const response = await request(app)
        .post('/ownTracks')
        .set('Authorization', 'Bearer sometoken')
        .send({ _type: 'location' })

      expect(response.status).toBe(401)
      expect(response.body.error).toBe('Unauthorized')
    })

    test('returns 401 with malformed Basic auth (no colon)', async () => {
      const app = createTestApp()
      const encoded = Buffer.from('nocolon').toString('base64')
      const response = await request(app)
        .post('/ownTracks')
        .set('Authorization', `Basic ${encoded}`)
        .send({ _type: 'location' })

      expect(response.status).toBe(401)
      expect(response.body.error).toBe('Unauthorized')
    })

    test('returns 401 when loginToUserDb fails with authentication error', async () => {
      vi.mocked(mockDeps.loginToUserDb).mockRejectedValue(
        new Error('password authentication failed for user "testuser"'),
      )

      const app = createTestApp()
      const response = await request(app)
        .post('/ownTracks')
        .set('Authorization', basicAuth('testuser', 'wrongpass'))
        .send({ _type: 'location' })

      expect(response.status).toBe(401)
      expect(response.body.error).toBe('Invalid credentials')
      expect(response.headers['www-authenticate']).toBe('Basic realm="OwnTracks"')
    })

    test('returns 500 for non-auth database errors', async () => {
      vi.mocked(mockDeps.loginToUserDb).mockRejectedValue(new Error('Connection refused'))

      const app = createTestApp()
      const response = await request(app)
        .post('/ownTracks')
        .set('Authorization', basicAuth('testuser', 'testpass'))
        .send({ _type: 'location' })

      expect(response.status).toBe(500)
      expect(response.body.error).toBe('Internal server error')
    })

    test('calls loginToUserDb with correct credentials', async () => {
      vi.mocked(mockDeps.loginToUserDb).mockResolvedValue()

      const app = createTestApp()
      await request(app)
        .post('/ownTracks')
        .set('Authorization', basicAuth('myuser', 'mypassword'))
        .send({ _type: 'status' })

      expect(mockDeps.loginToUserDb).toHaveBeenCalledWith('myuser', 'mypassword')
    })
  })

  describe('Location messages', () => {
    beforeEach(() => {
      vi.mocked(mockDeps.loginToUserDb).mockResolvedValue()
    })

    test('stores location data correctly', async () => {
      vi.mocked(mockDeps.insertLocation).mockResolvedValue()

      const app = createTestApp()
      const timestamp = 1705936800 // 2024-01-22T14:00:00Z

      const response = await request(app)
        .post('/ownTracks')
        .set('Authorization', basicAuth('testuser', 'testpass'))
        .send({
          _type: 'location',
          acc: 10,
          alt: 100,
          inregions: ['home', 'city'],
          lat: 59.3293,
          lon: 18.0686,
          tst: timestamp,
          vel: 5,
        })

      expect(response.status).toBe(200)
      expect(response.text).toBe('[]')

      expect(mockDeps.insertLocation).toHaveBeenCalledWith('testuser', {
        accuracy: 10,
        altitude: 100,
        lat: 59.3293,
        lon: 18.0686,
        regions: ['home', 'city'],
        source: 'owntracks',
        time: new Date(timestamp * 1000),
        velocity: 5,
      })
    })

    test('handles location with minimal fields', async () => {
      vi.mocked(mockDeps.insertLocation).mockResolvedValue()

      const app = createTestApp()
      const timestamp = 1705936800

      await request(app).post('/ownTracks').set('Authorization', basicAuth('testuser', 'testpass')).send({
        _type: 'location',
        lat: 59.3293,
        lon: 18.0686,
        tst: timestamp,
      })

      expect(mockDeps.insertLocation).toHaveBeenCalledWith('testuser', {
        accuracy: undefined,
        altitude: undefined,
        lat: 59.3293,
        lon: 18.0686,
        regions: undefined,
        source: 'owntracks',
        time: new Date(timestamp * 1000),
        velocity: undefined,
      })
    })
  })

  describe('Waypoint messages', () => {
    beforeEach(() => {
      vi.mocked(mockDeps.loginToUserDb).mockResolvedValue()
    })

    test('stores waypoint data correctly', async () => {
      vi.mocked(mockDeps.insertPlace).mockResolvedValue()

      const app = createTestApp()

      const response = await request(app)
        .post('/ownTracks')
        .set('Authorization', basicAuth('testuser', 'testpass'))
        .send({
          _type: 'waypoint',
          desc: 'Home',
          lat: 59.3293,
          lon: 18.0686,
          rad: 100,
          rid: 'home-123',
        })

      expect(response.status).toBe(200)
      expect(response.text).toBe('[]')

      expect(mockDeps.insertPlace).toHaveBeenCalledWith('testuser', {
        externalId: 'home-123',
        lat: 59.3293,
        lon: 18.0686,
        name: 'Home',
        radius: 100,
        source: 'owntracks',
      })
    })
  })

  describe('Status messages', () => {
    beforeEach(() => {
      vi.mocked(mockDeps.loginToUserDb).mockResolvedValue()
    })

    test('accepts status messages without storing anything', async () => {
      const app = createTestApp()

      const response = await request(app)
        .post('/ownTracks')
        .set('Authorization', basicAuth('testuser', 'testpass'))
        .send({
          _type: 'status',
          status: 1,
        })

      expect(response.status).toBe(200)
      expect(response.text).toBe('[]')

      expect(mockDeps.insertLocation).not.toHaveBeenCalled()
      expect(mockDeps.insertPlace).not.toHaveBeenCalled()
    })
  })

  describe('Unknown message types', () => {
    beforeEach(() => {
      vi.mocked(mockDeps.loginToUserDb).mockResolvedValue()
    })

    test('accepts unknown message types without error', async () => {
      const app = createTestApp()

      const response = await request(app)
        .post('/ownTracks')
        .set('Authorization', basicAuth('testuser', 'testpass'))
        .send({
          _type: 'transition',
          event: 'enter',
        })

      expect(response.status).toBe(200)
      expect(response.text).toBe('[]')

      expect(mockDeps.insertLocation).not.toHaveBeenCalled()
      expect(mockDeps.insertPlace).not.toHaveBeenCalled()
    })
  })
})
