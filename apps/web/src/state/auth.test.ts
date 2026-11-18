import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type * as AuthState from './auth'

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<{ AxiosError: typeof AxiosError; default: typeof axios }>()
  return { ...actual, default: { ...actual.default, get: vi.fn(), post: vi.fn() } }
})
vi.mock('../config', () => ({ API_URL: 'http://api.test' }))
vi.mock('../embed', () => ({ readNativeAuth: () => null }))

const PASSWORD = 'correct horse battery staple'

const failedRequest = (status?: number) => {
  const config = {
    data: JSON.stringify({ password: PASSWORD, username: 'alice' }),
    headers: {},
    method: 'post',
    url: 'http://api.test/login',
  } as unknown as InternalAxiosRequestConfig
  const response =
    status === undefined
      ? undefined
      : ({
          config,
          data: { error: 'Invalid credentials' },
          headers: {},
          status,
          statusText: '',
        } as AxiosResponse)
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, { body: PASSWORD }, response)
}

let state: typeof AuthState

beforeAll(async () => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, value),
  })
  vi.stubGlobal('sessionStorage', { getItem: () => null, removeItem: () => {}, setItem: () => {} })
  state = await import('./auth')
})

afterEach(() => {
  vi.restoreAllMocks()
})

const logged = (calls: unknown[][]): string =>
  calls
    .map((args) => args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
    .join('\n')

describe('auth failure logging', () => {
  it('logs a failed login as a fixed message and the status, nothing from the request', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(axios.post).mockRejectedValueOnce(failedRequest(401))

    const result = await state.login('alice', PASSWORD)

    expect(result).toEqual({ error: 'Invalid credentials', success: false })
    expect(errorSpy.mock.calls).toEqual([['Login failed', 401]])
    expect(logged(errorSpy.mock.calls)).not.toContain(PASSWORD)
  })

  it('logs network for a signup that got no response', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(axios.post).mockRejectedValueOnce(failedRequest())

    await state.signup('alice', PASSWORD)

    expect(errorSpy.mock.calls).toEqual([['Signup failed', 'network']])
  })
})
