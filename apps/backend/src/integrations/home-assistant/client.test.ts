import type { AxiosRequestConfig } from 'axios'

import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, test } from 'vitest'

import { SafeFetchError } from '../../services/safe-fetch.ts'
import {
  createAssertReachable,
  HomeAssistantApiError,
  homeAssistantClient,
  type HomeAssistantHttp,
  homeAssistantReachability,
} from './client.ts'

const TOKEN = 'secret-long-lived-token-abc123'
const conn = { baseUrl: 'https://ha.example.org', token: TOKEN }
const start = new Date('2026-11-10T00:00:00Z')
const end = new Date('2026-11-11T00:00:00Z')

const state = (entity_id: string, last_updated: string, extra: Record<string, unknown> = {}) => ({
  attributes: { latitude: 59.3, longitude: 18.1 },
  entity_id,
  last_changed: last_updated,
  last_updated,
  state: 'not_home',
  ...extra,
})

const recordingHttp = (data: unknown) => {
  const calls: { url: string; config: AxiosRequestConfig }[] = []
  const http: HomeAssistantHttp = async (url, config) => {
    calls.push({ config, url })
    return { data }
  }
  return { calls, http }
}

const failingHttp =
  (error: unknown): HomeAssistantHttp =>
  async () => {
    throw error
  }

const axiosError = (status?: number, code?: string): AxiosError => {
  const config = { headers: new AxiosHeaders({ Authorization: `Bearer ${TOKEN}` }) }
  return new AxiosError(
    `Request failed with status code ${status} Bearer ${TOKEN}`,
    code,
    config,
    {},
    status === undefined
      ? undefined
      : { config, data: { message: TOKEN }, headers: {}, status, statusText: 'x' },
  )
}

const allow = async () => {}

const captureError = async (promise: Promise<unknown>): Promise<HomeAssistantApiError> => {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(HomeAssistantApiError)
    expect((error as Error).message).not.toContain(TOKEN)
    expect(JSON.stringify(error)).not.toContain(TOKEN)
    return error as HomeAssistantApiError
  }
  throw new Error('expected a rejection')
}

describe('homeAssistantClient.getHistory', () => {
  test('requests the history API with encoded timestamps and the required flags', async () => {
    const { calls, http } = recordingHttp([[]])
    await homeAssistantClient({ assertReachable: allow, http }).getHistory(
      { ...conn, baseUrl: 'https://ha.example.org/' },
      'device_tracker.pixel_8',
      start,
      end,
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      'https://ha.example.org/api/history/period/2026-11-10T00%3A00%3A00.000Z' +
        '?filter_entity_id=device_tracker.pixel_8' +
        '&end_time=2026-11-11T00%3A00%3A00.000Z' +
        '&significant_changes_only=0' +
        '&skip_initial_state',
    )
    expect(calls[0].url).not.toContain('minimal_response')
    expect(calls[0].url).not.toContain('no_attributes')
    expect(calls[0].config).toMatchObject({
      headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}` },
      maxContentLength: 25 * 1024 * 1024,
      maxRedirects: 0,
      timeout: 20_000,
    })
  })

  test('checks reachability of every request URL before fetching', async () => {
    const checked: string[] = []
    const { calls, http } = recordingHttp([])
    const client = homeAssistantClient({ assertReachable: async (url) => void checked.push(url), http })
    await client.getHistory(conn, 'person.me', start, end)
    await client.getStates(conn)
    expect(checked).toEqual(calls.map((call) => call.url))
  })

  test('flattens the array of arrays, drops malformed items and sorts by last_updated', async () => {
    const { http } = recordingHttp([
      [state('person.me', '2026-11-10T10:00:00+00:00'), { entity_id: 'person.me' }],
      [state('person.me', '2026-11-10T08:00:00+00:00'), 'junk', { ...state('x', 'y'), attributes: 'nope' }],
      'not an array',
    ])
    const states = await homeAssistantClient({ assertReachable: allow, http }).getHistory(
      conn,
      'person.me',
      start,
      end,
    )
    expect(states.map((s) => s.last_updated)).toEqual([
      '2026-11-10T08:00:00+00:00',
      '2026-11-10T10:00:00+00:00',
    ])
  })

  test('a state without last_updated is timed by last_changed', async () => {
    const { last_updated: _omitted, ...compressed } = state('person.me', '2026-11-10T09:00:00+00:00')
    const { http } = recordingHttp([[compressed]])
    const states = await homeAssistantClient({ assertReachable: allow, http }).getHistory(
      conn,
      'person.me',
      start,
      end,
    )
    expect(states.map((s) => s.last_updated)).toEqual(['2026-11-10T09:00:00+00:00'])
  })

  test('rejects a response that is not an array', async () => {
    const { http } = recordingHttp({ message: 'nope' })
    const error = await captureError(
      homeAssistantClient({ assertReachable: allow, http }).getHistory(conn, 'person.me', start, end),
    )
    expect(error.message).toBe('Home Assistant sent an unexpected response')
  })
})

describe('homeAssistantClient.getStates', () => {
  test('fetches /api/states and keeps well-formed states', async () => {
    const { calls, http } = recordingHttp([state('person.me', '2026-11-10T08:00:00+00:00'), { nope: true }])
    const states = await homeAssistantClient({ assertReachable: allow, http }).getStates(conn)
    expect(calls[0].url).toBe('https://ha.example.org/api/states')
    expect(states.map((s) => s.entity_id)).toEqual(['person.me'])
  })
})

describe('error mapping', () => {
  const getStatesFailing = (error: unknown) =>
    homeAssistantClient({ assertReachable: allow, http: failingHttp(error) }).getStates(conn)

  test.each([
    [401, 'Home Assistant rejected the access token'],
    [403, 'Home Assistant rejected the access token'],
    [404, 'Home Assistant answered 404: check the URL'],
    [302, 'Home Assistant answered 302 (a redirect): check the URL'],
    [500, 'Home Assistant answered 500'],
  ])('%i → %s', async (status, message) => {
    const error = await captureError(getStatesFailing(axiosError(status)))
    expect(error.message).toBe(message)
    expect(error.status).toBe(status)
  })

  test('no response → could not reach, with the error code', async () => {
    const error = await captureError(getStatesFailing(axiosError(undefined, 'ECONNREFUSED')))
    expect(error.message).toBe('Could not reach Home Assistant (ECONNREFUSED)')
  })

  test('a private address names the admin setting', async () => {
    const error = await captureError(
      homeAssistantClient({
        assertReachable: async () => {
          throw new SafeFetchError(
            'Refusing to fetch a private/loopback/reserved address (10.0.0.2)',
            'private_address',
          )
        },
        http: failingHttp(new Error('unreachable')),
      }).getStates(conn),
    )
    expect(error.message).toContain('private')
    expect(error.message).toContain('HOME_ASSISTANT_ALLOW_PRIVATE_ADDRESSES')
  })

  test('a host that resolves to a private address at connect time names the admin setting', async () => {
    const error = await captureError(getStatesFailing(axiosError(undefined, 'private_address')))
    expect(error.message).toContain('HOME_ASSISTANT_ALLOW_PRIVATE_ADDRESSES')
  })

  test('a DNS failure outside axios → could not reach, with its code', async () => {
    const dnsError = Object.assign(new Error(`getaddrinfo ENOTFOUND ${TOKEN}`), { code: 'ENOTFOUND' })
    const error = await captureError(getStatesFailing(dnsError))
    expect(error.message).toBe('Could not reach Home Assistant (ENOTFOUND)')
  })
})

describe('homeAssistantReachability', () => {
  test('pins connections to checked addresses by default, and sends the agent with each request', async () => {
    const { httpsAgent, assertReachable } = homeAssistantReachability(false)
    expect(httpsAgent?.options.lookup).toBeTypeOf('function')
    const { calls, http } = recordingHttp([])
    await homeAssistantClient({ assertReachable: allow, http, httpsAgent }).getStates(conn)
    expect(calls[0].config.httpsAgent).toBe(httpsAgent)
    await expect(assertReachable('https://127.0.0.1/api/states')).rejects.toBeInstanceOf(SafeFetchError)
  })

  test('leaves the connection alone when private addresses are allowed', () => {
    expect(homeAssistantReachability(true).httpsAgent).toBeUndefined()
  })
})

describe('createAssertReachable', () => {
  test('requires https by default', async () => {
    const error = await captureError(createAssertReachable(false)('http://ha.example.org/api/states'))
    expect(error.message).toBe('The Home Assistant URL must use https')
  })

  test('refuses a private https address by default', async () => {
    await expect(createAssertReachable(false)('https://127.0.0.1/api/states')).rejects.toBeInstanceOf(
      SafeFetchError,
    )
  })

  test('allows http and private addresses when allowed', async () => {
    await expect(createAssertReachable(true)('http://192.168.1.5:8123/api/states')).resolves.toBeUndefined()
    await expect(createAssertReachable(true)('https://127.0.0.1/api/states')).resolves.toBeUndefined()
  })

  test('still requires an http(s) scheme when allowed', async () => {
    const error = await captureError(createAssertReachable(true)('ftp://ha.local/api/states'))
    expect(error.message).toBe('The Home Assistant URL must use http or https')
  })
})
