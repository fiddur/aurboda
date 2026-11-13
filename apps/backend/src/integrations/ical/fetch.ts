/**
 * Fetches a calendar's ICS feed. The URL is whatever a user typed, and the
 * server fetches it on every calendar sync, so by default it may only lead to
 * public addresses: each redirect hop is checked like the first URL, and the
 * connection is pinned to the address that was checked. A server on a private
 * network, whose users are trusted with it, opts out with
 * `CALENDAR_ALLOW_PRIVATE_ADDRESSES=true`.
 */

import type { AxiosRequestConfig } from 'axios'

import axios, { isAxiosError } from 'axios'
import http from 'node:http'
import https from 'node:https'

import { assertPublicUrl, createPublicOnlyLookup, SafeFetchError } from '../../services/safe-fetch.ts'

export type IcsHttp = (
  url: string,
  config: AxiosRequestConfig,
) => Promise<{ data: unknown; headers: Record<string, unknown>; status: number }>

export interface FetchIcsDeps {
  allowPrivate: boolean
  http?: IcsHttp
  assertPublic?: (url: string) => Promise<void>
}

const REQUEST_TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024
/** Calendar hosts redirect to a canonical or signed URL; a handful of hops covers them. */
const MAX_REDIRECTS = 5

export const PRIVATE_CALENDAR_ADDRESS_MESSAGE =
  'The calendar address is private (local network or loopback); the server admin can allow it with CALENDAR_ALLOW_PRIVATE_ADDRESSES=true'

const publicOnlyLookup = createPublicOnlyLookup()
const publicOnlyAgents = {
  httpAgent: new http.Agent({ lookup: publicOnlyLookup }),
  httpsAgent: new https.Agent({ lookup: publicOnlyLookup }),
}

const httpUrl = (raw: string): URL => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('The calendar URL is not a valid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The calendar URL must use http or https')
  }
  return url
}

/**
 * Messages come from the status or the error code only: an ICS URL usually
 * carries the calendar's secret token, an axios error carries the URL, and
 * these messages are stored as the calendar's sync error.
 */
const toFetchError = (error: unknown): Error => {
  if (error instanceof SafeFetchError) {
    if (error.code === 'private_address') return new Error(PRIVATE_CALENDAR_ADDRESS_MESSAGE)
    if (error.code === 'dns') return new Error('Could not resolve the calendar host')
    return new Error('The calendar URL is not a valid http(s) URL')
  }
  if (isAxiosError(error)) {
    if (error.code === 'private_address') return new Error(PRIVATE_CALENDAR_ADDRESS_MESSAGE)
    const response = error.response
    if (response) return new Error(`Failed to fetch ICS: ${response.status} ${response.statusText}`.trim())
    return new Error(`Failed to fetch ICS (${error.code ?? 'no response'})`)
  }
  return error instanceof Error ? error : new Error('Failed to fetch ICS')
}

const redirectTarget = (response: { headers: Record<string, unknown>; status: number }, from: URL) => {
  if (response.status < 300 || response.status >= 400) return null
  const location = response.headers.location
  if (typeof location !== 'string' || location === '') {
    throw new Error(`Failed to fetch ICS: ${response.status} without a Location`)
  }
  return new URL(location, from).toString()
}

export const createFetchIcs = (deps: FetchIcsDeps) => {
  const request: IcsHttp = deps.http ?? ((url, config) => axios.get(url, config))
  const assertPublic = deps.assertPublic ?? assertPublicUrl

  const fetchHop = async (raw: string): Promise<{ body: string } | { redirect: string }> => {
    const url = httpUrl(raw)
    if (!deps.allowPrivate) await assertPublic(url.toString())
    const response = await request(url.toString(), {
      ...(deps.allowPrivate ? {} : publicOnlyAgents),
      headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5' },
      maxBodyLength: MAX_RESPONSE_BYTES,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxRedirects: 0,
      responseType: 'text',
      timeout: REQUEST_TIMEOUT_MS,
      transformResponse: (data: unknown) => data,
      validateStatus: (status) => status >= 200 && status < 400,
    })
    const redirect = redirectTarget(response, url)
    if (redirect) return { redirect }
    return { body: typeof response.data === 'string' ? response.data : String(response.data ?? '') }
  }

  return async (url: string): Promise<string> => {
    try {
      let next = url
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const result = await fetchHop(next)
        if ('body' in result) return result.body
        next = result.redirect
      }
      throw new Error(`Failed to fetch ICS: more than ${MAX_REDIRECTS} redirects`)
    } catch (error) {
      throw toFetchError(error)
    }
  }
}

export const calendarAllowsPrivateAddresses = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.CALENDAR_ALLOW_PRIVATE_ADDRESSES === 'true'
