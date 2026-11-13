import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import type { UserSettings } from '../db/types.ts'
import type { HomeAssistantClient } from '../integrations/home-assistant/client.ts'

import { HomeAssistantApiError } from '../integrations/home-assistant/client.ts'
import { createHomeAssistantRouter } from './home-assistant-router.ts'

const configured: UserSettings = {
  home_assistant_token: 'token',
  home_assistant_url: 'https://ha.example.org',
}

const buildApp = (settings: UserSettings, getStates: HomeAssistantClient['getStates']) => {
  const app = express()
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use(
    '/home-assistant',
    createHomeAssistantRouter(auth, {
      client: { getHistory: async () => [], getStates },
      getSettings: async () => settings,
    }),
  )
  return app
}

describe('GET /home-assistant/entities', () => {
  test('lists trackable entities', async () => {
    const response = await supertest(
      buildApp(configured, async () => [
        {
          attributes: { friendly_name: 'Pixel', latitude: 1, longitude: 2 },
          entity_id: 'device_tracker.pixel',
          last_updated: '2026-11-10T08:00:00Z',
          state: 'not_home',
        },
      ]),
    ).get('/home-assistant/entities')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      data: [{ entity_id: 'device_tracker.pixel', name: 'Pixel', state: 'not_home' }],
      success: true,
    })
  })

  test('400 when the URL or token is missing', async () => {
    const response = await supertest(buildApp({}, async () => [])).get('/home-assistant/entities')
    expect(response.status).toBe(400)
    expect(response.body.success).toBe(false)
  })

  test('502 with the message when Home Assistant fails', async () => {
    const response = await supertest(
      buildApp(configured, async () => {
        throw new HomeAssistantApiError('Home Assistant rejected the access token', 401)
      }),
    ).get('/home-assistant/entities')
    expect(response.status).toBe(502)
    expect(response.body).toEqual({ error: 'Home Assistant rejected the access token', success: false })
  })
})
