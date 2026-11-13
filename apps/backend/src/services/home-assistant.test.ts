import { describe, expect, test } from 'vitest'

import type { HomeAssistantClient } from '../integrations/home-assistant/client.ts'

import { HomeAssistantApiError } from '../integrations/home-assistant/client.ts'
import { listHomeAssistantEntities } from './home-assistant.ts'

const settings = { home_assistant_token: 'token', home_assistant_url: 'https://ha.example.org' }

const client = (getStates: HomeAssistantClient['getStates']): HomeAssistantClient => ({
  getHistory: async () => [],
  getStates,
})

describe('listHomeAssistantEntities', () => {
  test('needs the URL and the token', async () => {
    const result = await listHomeAssistantEntities('alice', {
      client: client(async () => []),
      getSettings: async () => ({ home_assistant_url: settings.home_assistant_url }),
    })
    expect(result).toMatchObject({ ok: false, reason: 'not_configured' })
  })

  test('lists trackable entities from /api/states', async () => {
    const seen: unknown[] = []
    const result = await listHomeAssistantEntities('alice', {
      client: client(async (conn) => {
        seen.push(conn)
        return [
          {
            attributes: { friendly_name: 'Me', latitude: 1, longitude: 2 },
            entity_id: 'person.me',
            last_updated: '2026-11-10T08:00:00Z',
            state: 'home',
          },
          { attributes: {}, entity_id: 'light.kitchen', last_updated: '2026-11-10T08:00:00Z', state: 'on' },
        ]
      }),
      getSettings: async () => settings,
    })
    expect(seen).toEqual([{ baseUrl: 'https://ha.example.org', token: 'token' }])
    expect(result).toEqual({ entities: [{ entity_id: 'person.me', name: 'Me', state: 'home' }], ok: true })
  })

  test('reports a Home Assistant failure as unreachable with its message', async () => {
    const result = await listHomeAssistantEntities('alice', {
      client: client(async () => {
        throw new HomeAssistantApiError('Home Assistant rejected the access token', 401)
      }),
      getSettings: async () => settings,
    })
    expect(result).toEqual({
      error: 'Home Assistant rejected the access token',
      ok: false,
      reason: 'unreachable',
    })
  })
})
