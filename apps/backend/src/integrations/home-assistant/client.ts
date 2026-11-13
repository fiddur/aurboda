/**
 * Home Assistant REST client. The long-lived token goes in the Authorization
 * header and nowhere else: error messages are built from the status or error
 * code only, because an axios error carries the request config (headers
 * included) and these messages end up in the sync status bar and the audit log.
 */

import type { AxiosRequestConfig } from 'axios'

import axios, { isAxiosError } from 'axios'
import https from 'node:https'

import type { HomeAssistantState } from './process.ts'

import { assertPublicUrl, createPublicOnlyLookup, SafeFetchError } from '../../services/safe-fetch.ts'

export interface HomeAssistantConnection {
  baseUrl: string
  token: string
}

export type HomeAssistantHttp = (url: string, config: AxiosRequestConfig) => Promise<{ data: unknown }>

export type AssertReachable = (url: string) => Promise<void>

export class HomeAssistantApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'HomeAssistantApiError'
    this.status = status
  }
}

const REQUEST_TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024

/**
 * With `allowPrivate` false (the default deployment), only public https targets;
 * with it true (a self-hosted server on HA's LAN), any http(s) target.
 */
export const createAssertReachable =
  (allowPrivate: boolean): AssertReachable =>
  async (url) => {
    let protocol: string
    try {
      protocol = new URL(url).protocol
    } catch {
      throw new HomeAssistantApiError('The Home Assistant URL is not a valid URL')
    }
    if (allowPrivate) {
      if (protocol !== 'http:' && protocol !== 'https:') {
        throw new HomeAssistantApiError('The Home Assistant URL must use http or https')
      }
      return
    }
    if (protocol !== 'https:') throw new HomeAssistantApiError('The Home Assistant URL must use https')
    await assertPublicUrl(url)
  }

/**
 * What the client needs to stay off the server's own network. Outside
 * `allowPrivate` the agent pins every connection to an address the guard
 * accepts: the URL is the user's and is polled for as long as it is stored, so
 * a hostname that flips to an internal address after the check would otherwise
 * turn the error messages into a probe of that network.
 */
export const homeAssistantReachability = (
  allowPrivate: boolean,
): { assertReachable: AssertReachable; httpsAgent?: https.Agent } => ({
  assertReachable: createAssertReachable(allowPrivate),
  httpsAgent: allowPrivate ? undefined : new https.Agent({ lookup: createPublicOnlyLookup() }),
})

const statusMessage = (status: number): string => {
  if (status === 401 || status === 403) return 'Home Assistant rejected the access token'
  if (status === 404) return 'Home Assistant answered 404: check the URL'
  if (status >= 300 && status < 400) return `Home Assistant answered ${status} (a redirect): check the URL`
  return `Home Assistant answered ${status}`
}

const errorCode = (error: unknown): string | undefined => {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

const privateAddressError = (): HomeAssistantApiError =>
  new HomeAssistantApiError(
    'The Home Assistant address is private (local network or loopback); the server admin can allow it with HOME_ASSISTANT_ALLOW_PRIVATE_ADDRESSES=true',
  )

export const toHomeAssistantError = (error: unknown): HomeAssistantApiError => {
  if (error instanceof HomeAssistantApiError) return error
  if (error instanceof SafeFetchError) {
    if (error.code === 'private_address') return privateAddressError()
    if (error.code === 'dns') return new HomeAssistantApiError('Could not resolve the Home Assistant host')
    return new HomeAssistantApiError('The Home Assistant URL is not a valid http(s) URL')
  }
  if (isAxiosError(error)) {
    const status = error.response?.status
    if (status !== undefined) return new HomeAssistantApiError(statusMessage(status), status)
    if (error.code === 'private_address') return privateAddressError()
    return new HomeAssistantApiError(`Could not reach Home Assistant (${error.code ?? 'no response'})`)
  }
  return new HomeAssistantApiError(`Could not reach Home Assistant (${errorCode(error) ?? 'unknown error'})`)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toState = (item: unknown): HomeAssistantState | null => {
  if (!isRecord(item)) return null
  const { attributes, entity_id, state } = item
  const last_changed = typeof item.last_changed === 'string' ? item.last_changed : undefined
  // HA's compressed state formats leave `last_updated` out when it equals `last_changed`.
  const last_updated = typeof item.last_updated === 'string' ? item.last_updated : last_changed
  if (typeof entity_id !== 'string' || last_updated === undefined || !isRecord(attributes)) return null
  return { attributes, entity_id, last_changed, last_updated, state: typeof state === 'string' ? state : '' }
}

const toStates = (items: unknown[]): HomeAssistantState[] =>
  items.map(toState).filter((state): state is HomeAssistantState => state !== null)

const expectArray = (data: unknown): unknown[] => {
  if (!Array.isArray(data)) throw new HomeAssistantApiError('Home Assistant sent an unexpected response')
  return data
}

const apiUrl = (baseUrl: string, path: string): string => `${baseUrl.replace(/\/+$/, '')}${path}`

export const historyUrl = (baseUrl: string, entityId: string, start: Date, end: Date): string =>
  apiUrl(
    baseUrl,
    `/api/history/period/${encodeURIComponent(start.toISOString())}` +
      `?filter_entity_id=${encodeURIComponent(entityId)}` +
      `&end_time=${encodeURIComponent(end.toISOString())}` +
      // Without it a person.* entity only reports changes of its state string,
      // so a move that stays `not_home` would be lost.
      `&significant_changes_only=0` +
      // Without it HA prepends the state as of `start`, re-stamped to `start`,
      // which would invent a fix at every sync start.
      `&skip_initial_state`,
  )

export interface HomeAssistantClient {
  getStates: (conn: HomeAssistantConnection) => Promise<HomeAssistantState[]>
  getHistory: (
    conn: HomeAssistantConnection,
    entityId: string,
    start: Date,
    end: Date,
  ) => Promise<HomeAssistantState[]>
}

export const homeAssistantClient = (deps: {
  http?: HomeAssistantHttp
  assertReachable: AssertReachable
  httpsAgent?: https.Agent
}): HomeAssistantClient => {
  const http: HomeAssistantHttp = deps.http ?? ((url, config) => axios.get(url, config))

  const get = async (conn: HomeAssistantConnection, url: string): Promise<unknown> => {
    try {
      await deps.assertReachable(url)
      const response = await http(url, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${conn.token}` },
        httpsAgent: deps.httpsAgent,
        maxBodyLength: MAX_RESPONSE_BYTES,
        maxContentLength: MAX_RESPONSE_BYTES,
        maxRedirects: 0,
        timeout: REQUEST_TIMEOUT_MS,
      })
      return response.data
    } catch (error) {
      throw toHomeAssistantError(error)
    }
  }

  return {
    getHistory: async (conn, entityId, start, end) => {
      const data = expectArray(await get(conn, historyUrl(conn.baseUrl, entityId, start, end)))
      return toStates(data.flatMap((inner) => (Array.isArray(inner) ? inner : []))).sort(
        (a, b) => (Date.parse(a.last_updated) || 0) - (Date.parse(b.last_updated) || 0),
      )
    },
    getStates: async (conn) => toStates(expectArray(await get(conn, apiUrl(conn.baseUrl, '/api/states')))),
  }
}
