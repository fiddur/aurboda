import type { AxiosRequestConfig } from 'axios'

import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, test } from 'vitest'

import { SafeFetchError } from '../../services/safe-fetch.ts'
import {
  calendarAllowsPrivateAddresses,
  createFetchIcs,
  type IcsHttp,
  PRIVATE_CALENDAR_ADDRESS_MESSAGE,
} from './fetch.ts'

const SECRET_URL = 'https://calendar.example.org/ical/secret-token-abc123/basic.ics'
const ICS = 'BEGIN:VCALENDAR\nEND:VCALENDAR'

type Reply = { status: number; data?: unknown; location?: string }

const scripted = (replies: Record<string, Reply>) => {
  const calls: { url: string; config: AxiosRequestConfig }[] = []
  const http: IcsHttp = async (url, config) => {
    calls.push({ config, url })
    const reply = replies[url]
    if (!reply) throw new Error(`unexpected request to ${url}`)
    return {
      data: reply.data,
      headers: reply.location === undefined ? {} : { location: reply.location },
      status: reply.status,
    }
  }
  return { calls, http }
}

const publicOnly = async (url: string) => {
  const host = new URL(url).hostname
  if (host === 'localhost' || host.startsWith('10.') || host.startsWith('169.254.')) {
    throw new SafeFetchError(`Refusing to fetch a private address (${host})`, 'private_address')
  }
}

const messageOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('expected a rejection')
}

describe('createFetchIcs', () => {
  test('returns the feed text, without following redirects on its own and pinned to checked addresses', async () => {
    const { calls, http } = scripted({ [SECRET_URL]: { data: ICS, status: 200 } })
    const body = await createFetchIcs({ allowPrivate: false, assertPublic: publicOnly, http })(SECRET_URL)
    expect(body).toBe(ICS)
    expect(calls).toHaveLength(1)
    expect(calls[0].config.maxRedirects).toBe(0)
    expect(calls[0].config.httpsAgent?.options.lookup).toBeTypeOf('function')
    expect(calls[0].config.httpAgent?.options.lookup).toBeTypeOf('function')
  })

  test('refuses a private address before any request, naming the admin setting', async () => {
    const { calls, http } = scripted({})
    const fetchIcs = createFetchIcs({ allowPrivate: false, assertPublic: publicOnly, http })
    expect(await messageOf(fetchIcs('http://localhost:8080/cal.ics'))).toBe(PRIVATE_CALENDAR_ADDRESS_MESSAGE)
    expect(await messageOf(fetchIcs('http://169.254.169.254/latest/meta-data/'))).toContain(
      'CALENDAR_ALLOW_PRIVATE_ADDRESSES',
    )
    expect(calls).toEqual([])
  })

  test('the real guard refuses a loopback literal', async () => {
    const { calls, http } = scripted({})
    const message = await messageOf(createFetchIcs({ allowPrivate: false, http })('http://127.0.0.1/cal.ics'))
    expect(message).toBe(PRIVATE_CALENDAR_ADDRESS_MESSAGE)
    expect(calls).toEqual([])
  })

  test('follows a redirect to a public address, relative ones included', async () => {
    const { calls, http } = scripted({
      'https://calendar.example.org/feed': { location: '/v2/feed.ics', status: 302 },
      'https://calendar.example.org/v2/feed.ics': {
        location: 'https://cdn.example.net/feed.ics',
        status: 301,
      },
      'https://cdn.example.net/feed.ics': { data: ICS, status: 200 },
    })
    const fetchIcs = createFetchIcs({ allowPrivate: false, assertPublic: publicOnly, http })
    expect(await fetchIcs('https://calendar.example.org/feed')).toBe(ICS)
    expect(calls.map((call) => call.url)).toEqual([
      'https://calendar.example.org/feed',
      'https://calendar.example.org/v2/feed.ics',
      'https://cdn.example.net/feed.ics',
    ])
  })

  test('refuses a redirect that leads to a private address', async () => {
    const { calls, http } = scripted({
      'https://calendar.example.org/feed': { location: 'http://10.0.0.5/admin', status: 302 },
    })
    const fetchIcs = createFetchIcs({ allowPrivate: false, assertPublic: publicOnly, http })
    expect(await messageOf(fetchIcs('https://calendar.example.org/feed'))).toBe(
      PRIVATE_CALENDAR_ADDRESS_MESSAGE,
    )
    expect(calls).toHaveLength(1)
  })

  test('refuses a redirect to another scheme', async () => {
    const { http } = scripted({
      'https://calendar.example.org/feed': { location: 'file:///etc/passwd', status: 302 },
    })
    const fetchIcs = createFetchIcs({ allowPrivate: true, http })
    expect(await messageOf(fetchIcs('https://calendar.example.org/feed'))).toBe(
      'The calendar URL must use http or https',
    )
  })

  test('gives up on a redirect loop', async () => {
    const { calls, http } = scripted({
      'https://calendar.example.org/a': { location: 'https://calendar.example.org/a', status: 302 },
    })
    const fetchIcs = createFetchIcs({ allowPrivate: false, assertPublic: publicOnly, http })
    expect(await messageOf(fetchIcs('https://calendar.example.org/a'))).toBe(
      'Failed to fetch ICS: more than 5 redirects',
    )
    expect(calls).toHaveLength(6)
  })

  test('with private addresses allowed, fetches them without the guard or the pinned agents', async () => {
    const { calls, http } = scripted({ 'http://localhost:8080/cal.ics': { data: ICS, status: 200 } })
    const fetchIcs = createFetchIcs({
      allowPrivate: true,
      assertPublic: async () => {
        throw new Error('the guard must not run')
      },
      http,
    })
    expect(await fetchIcs('http://localhost:8080/cal.ics')).toBe(ICS)
    expect(calls[0].config.httpAgent).toBeUndefined()
    expect(calls[0].config.httpsAgent).toBeUndefined()
  })

  test('rejects a URL that is not http(s), allowed or not', async () => {
    const { http } = scripted({})
    expect(await messageOf(createFetchIcs({ allowPrivate: true, http })('ftp://example.org/cal.ics'))).toBe(
      'The calendar URL must use http or https',
    )
    expect(await messageOf(createFetchIcs({ allowPrivate: false, http })('not a url'))).toBe(
      'The calendar URL is not a valid URL',
    )
  })

  test('an error status is reported without the URL and its secret token', async () => {
    const config = { headers: new AxiosHeaders(), url: SECRET_URL }
    const failing: IcsHttp = async () => {
      throw new AxiosError(
        `Request failed for ${SECRET_URL}`,
        'ERR_BAD_REQUEST',
        config,
        {},
        {
          config,
          data: '',
          headers: {},
          status: 404,
          statusText: 'Not Found',
        },
      )
    }
    const message = await messageOf(
      createFetchIcs({ allowPrivate: false, assertPublic: publicOnly, http: failing })(SECRET_URL),
    )
    expect(message).toBe('Failed to fetch ICS: 404 Not Found')
  })

  test('a network failure is reported by its code, without the URL', async () => {
    const failing: IcsHttp = async () => {
      throw new AxiosError(`connect ECONNREFUSED ${SECRET_URL}`, 'ECONNREFUSED')
    }
    const message = await messageOf(
      createFetchIcs({ allowPrivate: false, assertPublic: publicOnly, http: failing })(SECRET_URL),
    )
    expect(message).toBe('Failed to fetch ICS (ECONNREFUSED)')
  })

  test('a host that resolves to a private address at connect time names the admin setting', async () => {
    const failing: IcsHttp = async () => {
      throw new AxiosError('Refusing to connect to a private address', 'private_address')
    }
    const message = await messageOf(
      createFetchIcs({ allowPrivate: false, assertPublic: publicOnly, http: failing })(SECRET_URL),
    )
    expect(message).toBe(PRIVATE_CALENDAR_ADDRESS_MESSAGE)
  })
})

describe('calendarAllowsPrivateAddresses', () => {
  test('only the literal true opts in', () => {
    expect(calendarAllowsPrivateAddresses({})).toBe(false)
    expect(calendarAllowsPrivateAddresses({ CALENDAR_ALLOW_PRIVATE_ADDRESSES: '1' })).toBe(false)
    expect(calendarAllowsPrivateAddresses({ CALENDAR_ALLOW_PRIVATE_ADDRESSES: 'true' })).toBe(true)
  })
})
