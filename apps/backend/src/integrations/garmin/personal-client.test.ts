import { describe, expect, test, vi } from 'vitest'

import type { OAuthToken } from '../../db/types.ts'

import {
  adaptPersonalSleep,
  GarminKeyRefusedError,
  garminPersonalClient,
  jwtExpiryMs,
} from './personal-client.ts'

const KEY = 'fake-api-key-for-tests'
const NOW = new Date('2026-11-13T12:00:00Z')
const BASE = 'https://personal.connectapi.garmin.com'
const TOKEN_URL = `${BASE}/personalapitoken-service/personal-api/personal-api-key/token`

const fakeJwt = (expiresAt: Date, tag = 'a'): string =>
  [
    Buffer.from('{"alg":"none"}').toString('base64url'),
    Buffer.from(JSON.stringify({ exp: Math.floor(expiresAt.getTime() / 1000), tag })).toString('base64url'),
    'fake-signature',
  ].join('.')

const hoursFromNow = (hours: number): Date => new Date(NOW.getTime() + hours * 3_600_000)

const reply = (status: number, body = ''): Response => new Response(status === 204 ? null : body, { status })
const json = (body: unknown): Response => reply(200, JSON.stringify(body))

const setup = ({
  stored = { access_token: '', provider: 'garmin_personal', refresh_token: KEY } as OAuthToken | null,
  responses = [] as Response[],
  now = () => NOW,
} = {}) => {
  let row = stored
  const queue = [...responses]
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = queue.shift()
    if (!next) throw new Error('unexpected fetch')
    return next
  })
  const deps = {
    auditError: vi.fn(),
    deleteOAuthToken: vi.fn(async () => {
      row = null
      return true
    }),
    fetch: fetch as unknown as typeof globalThis.fetch,
    getOAuthToken: vi.fn(async () => row),
    markOAuthTokenRefused: vi.fn(async (_user: string, _provider: string, refreshToken?: string) => {
      if (row && (refreshToken === undefined || row.refresh_token === refreshToken)) {
        row = { ...row, refused_at: NOW }
      }
    }),
    now,
    updateOAuthAccessToken: vi.fn(
      async (_user: string, _provider: string, refreshToken: string, accessToken: string) => {
        if (row?.refresh_token !== refreshToken) return false
        row = { ...row, access_token: accessToken }
        return true
      },
    ),
    upsertOAuthToken: vi.fn(async (_user: string, token: OAuthToken) => {
      row = { ...token, refused_at: undefined }
    }),
  }
  const replaceRow = (next: OAuthToken | null) => {
    row = next
  }
  return { client: garminPersonalClient(deps), deps, fetch, replaceRow, row: () => row }
}

const headerOf = (init: RequestInit | undefined, name: string): string | undefined =>
  (init?.headers as Record<string, string> | undefined)?.[name]

describe('jwtExpiryMs', () => {
  test('reads the exp claim in milliseconds', () => {
    expect(jwtExpiryMs(fakeJwt(hoursFromNow(24)))).toBe(hoursFromNow(24).getTime())
  })

  test('is null for something that is not a JWT', () => {
    expect(jwtExpiryMs('not-a-jwt')).toBeNull()
    expect(jwtExpiryMs('a.b.c')).toBeNull()
  })
})

describe('connect', () => {
  test('exchanges the key once and stores key, JWT and the key expiry', async () => {
    const jwt = fakeJwt(hoursFromNow(24))
    const { client, deps, fetch } = setup({ responses: [reply(200, `${jwt}\n`)], stored: null })
    const keyExpiry = new Date('2027-11-01T00:00:00Z')

    await client.connect('alice', KEY, keyExpiry)

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(TOKEN_URL)
    expect(init?.method).toBe('POST')
    expect(headerOf(init, 'Authorization')).toBe(`ApiKey ${KEY}`)
    expect(headerOf(init, 'Accept')).toBe('*/*')
    expect(deps.upsertOAuthToken).toHaveBeenCalledWith('alice', {
      access_token: jwt,
      expires_at: keyExpiry,
      provider: 'garmin_personal',
      refresh_token: KEY,
    })
  })

  test.each([401, 403])('a %i refusal throws and stores nothing', async (status) => {
    const { client, deps } = setup({ responses: [reply(status)], stored: null })

    await expect(client.connect('alice', KEY, new Date('2027-01-01'))).rejects.toBeInstanceOf(
      GarminKeyRefusedError,
    )
    expect(deps.upsertOAuthToken).not.toHaveBeenCalled()
  })
})

describe('disconnect', () => {
  test('deletes the stored key', async () => {
    const { client, deps } = setup()
    await client.disconnect('alice')
    expect(deps.deleteOAuthToken).toHaveBeenCalledWith('alice', 'garmin_personal')
  })
})

describe('token handling', () => {
  test('reuses a cached JWT with more than an hour left', async () => {
    const jwt = fakeJwt(hoursFromNow(5))
    const { client, fetch } = setup({
      responses: [json({ calendarDate: '2026-11-12' })],
      stored: { access_token: jwt, provider: 'garmin_personal', refresh_token: KEY },
    })

    await client.getHeartRate('alice', new Date('2026-11-12T00:00:00Z'))

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${BASE}/wellness-service/wellness/dailyHeartRate?date=2026-11-12`)
    expect(headerOf(init, 'Authorization')).toBe(`Bearer ${jwt}`)
    expect(headerOf(init, 'Accept')).toBe('application/json')
  })

  test('exchanges again and stores the new JWT when under an hour is left', async () => {
    const old = fakeJwt(hoursFromNow(0.5), 'old')
    const fresh = fakeJwt(hoursFromNow(24), 'fresh')
    const keyExpiry = new Date('2027-06-01T00:00:00Z')
    const { client, deps, fetch } = setup({
      responses: [reply(200, fresh), json({ calendarDate: '2026-11-12' })],
      stored: { access_token: old, expires_at: keyExpiry, provider: 'garmin_personal', refresh_token: KEY },
    })

    await client.getHeartRate('alice', new Date('2026-11-12T00:00:00Z'))

    expect(fetch.mock.calls[0]![0]).toBe(TOKEN_URL)
    expect(headerOf(fetch.mock.calls[1]![1], 'Authorization')).toBe(`Bearer ${fresh}`)
    expect(deps.updateOAuthAccessToken).toHaveBeenCalledWith('alice', 'garmin_personal', KEY, fresh)
    expect(deps.upsertOAuthToken).not.toHaveBeenCalled()
  })

  test('a data call answering 401 forces one re-exchange and one retry', async () => {
    const cached = fakeJwt(hoursFromNow(5), 'cached')
    const fresh = fakeJwt(hoursFromNow(24), 'fresh')
    const { client, fetch } = setup({
      responses: [reply(401), reply(200, fresh), json({ calendarDate: '2026-11-12' })],
      stored: { access_token: cached, provider: 'garmin_personal', refresh_token: KEY },
    })

    expect(await client.getHeartRate('alice', new Date('2026-11-12T00:00:00Z'))).toEqual({
      calendarDate: '2026-11-12',
    })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls[1]![0]).toBe(TOKEN_URL)
    expect(headerOf(fetch.mock.calls[2]![1], 'Authorization')).toBe(`Bearer ${fresh}`)
  })

  test('a refused exchange marks the key, audits, throws, and then nothing reaches Garmin', async () => {
    const { client, deps, fetch } = setup({ responses: [reply(401)] })

    await expect(client.getHeartRate('alice', new Date('2026-11-12'))).rejects.toBeInstanceOf(
      GarminKeyRefusedError,
    )
    expect(deps.markOAuthTokenRefused).toHaveBeenCalledWith('alice', 'garmin_personal', KEY)
    expect(deps.auditError).toHaveBeenCalledWith('alice', 'auth', 'Garmin refused the Personal API key', {
      status: 401,
    })

    await expect(client.getHrv('alice', new Date('2026-11-12'))).rejects.toBeInstanceOf(GarminKeyRefusedError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('a key replaced during the exchange keeps its JWT and its refusal state', async () => {
    const NEW_KEY = 'fake-api-key-replacement'
    const replacement: OAuthToken = {
      access_token: 'jwt-for-new-key',
      provider: 'garmin_personal',
      refresh_token: NEW_KEY,
    }
    const exchanged = (status: number, body = '') => {
      let release: (res: Response) => void = () => {}
      const pending = new Promise<Response>((resolve) => {
        release = resolve
      })
      return { pending, release: () => release(reply(status, body)) }
    }

    for (const status of [200, 401]) {
      const { client, deps, fetch, replaceRow, row } = setup()
      const exchange = exchanged(status, status === 200 ? fakeJwt(hoursFromNow(24), 'old-key') : '')
      fetch.mockImplementationOnce(() => exchange.pending)
      fetch.mockResolvedValueOnce(json({ calendarDate: '2026-11-12' }))

      const call = client.getHeartRate('alice', new Date('2026-11-12T00:00:00Z')).catch((e: unknown) => e)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
      replaceRow(replacement)
      exchange.release()
      await call

      expect(row()).toEqual(replacement)
      expect(deps.upsertOAuthToken).not.toHaveBeenCalled()
    }
  })

  test('a 429 surfaces as an error naming 429', async () => {
    const { client } = setup({
      responses: [reply(429)],
      stored: { access_token: fakeJwt(hoursFromNow(5)), provider: 'garmin_personal', refresh_token: KEY },
    })

    await expect(client.getHeartRate('alice', new Date('2026-11-12'))).rejects.toThrow(
      'Garmin Personal API 429 for /wellness-service/wellness/dailyHeartRate',
    )
  })

  test('no error message carries the key or the JWT', async () => {
    const jwt = fakeJwt(hoursFromNow(5))
    const failures = [
      setup({ responses: [reply(500)] }),
      setup({
        responses: [reply(503)],
        stored: { access_token: jwt, provider: 'garmin_personal', refresh_token: KEY },
      }),
    ]
    const networkFailure = setup({
      stored: { access_token: jwt, provider: 'garmin_personal', refresh_token: KEY },
    })
    networkFailure.fetch.mockRejectedValueOnce(new Error(`socket closed sending Bearer ${jwt} for ${KEY}`))

    for (const { client } of [...failures, networkFailure]) {
      const error = await client.getHeartRate('alice', new Date('2026-11-12')).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).not.toContain(KEY)
      expect((error as Error).message).not.toContain(jwt)
    }
  })

  test('without a stored key it throws before any request', async () => {
    const { client, fetch } = setup({ stored: null })
    await expect(client.getHeartRate('alice', new Date('2026-11-12'))).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('data adapters', () => {
  const cachedRow = {
    access_token: fakeJwt(hoursFromNow(5)),
    provider: 'garmin_personal',
    refresh_token: KEY,
  }

  test('HRV answering 204 is null', async () => {
    const { client } = setup({ responses: [reply(204)], stored: cachedRow })
    expect(await client.getHrv('alice', new Date('2026-11-12'))).toBeNull()
  })

  test('respiration and intensity minutes come from one daily summary request', async () => {
    const summary = {
      avgWakingRespirationValue: 14,
      calendarDate: '2026-11-12',
      highestRespirationValue: 20,
      intensityMinutesGoal: 150,
      latestRespirationValue: 13,
      lowestRespirationValue: 9,
      moderateIntensityMinutes: 30,
      totalSteps: 9000,
      vigorousIntensityMinutes: 10,
    }
    const { client, fetch } = setup({ responses: [json(summary)], stored: cachedRow })
    const day = new Date('2026-11-12T00:00:00Z')

    expect(await client.getDailySummary('alice', day)).toEqual(summary)
    expect(await client.getRespiration('alice', day)).toEqual({
      avgWakingRespirationValue: 14,
      calendarDate: '2026-11-12',
      highestRespirationValue: 20,
      latestRespirationValue: 13,
      lowestRespirationValue: 9,
    })
    expect(await client.getIntensityMinutes('alice', day)).toEqual({
      calendarDate: '2026-11-12',
      moderateIntensityMinutes: 30,
      vigorousIntensityMinutes: 10,
      weeklyGoal: 150,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]![0]).toBe(
      `${BASE}/usersummary-service/usersummary/daily?calendarDate=2026-11-12`,
    )
  })

  test('the memoised summary expires after 60 seconds', async () => {
    let now = NOW
    const { client, fetch } = setup({
      now: () => now,
      responses: [json({ calendarDate: '2026-11-12' }), json({ calendarDate: '2026-11-12' })],
      stored: cachedRow,
    })
    const day = new Date('2026-11-12T00:00:00Z')

    await client.getDailySummary('alice', day)
    now = new Date(NOW.getTime() + 61_000)
    await client.getRespiration('alice', day)

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('sleep is fetched from dailySleep and wrapped for the processor', async () => {
    const dto = { calendarDate: '2026-11-12', sleepEndTimestampGMT: 1_000, sleepStartTimestampGMT: 500 }
    const { client, fetch } = setup({ responses: [json(dto)], stored: cachedRow })

    expect(await client.getSleep('alice', new Date('2026-11-12T00:00:00Z'))).toEqual({ dailySleepDTO: dto })
    expect(fetch.mock.calls[0]![0]).toBe(`${BASE}/sleep-service/sleep/dailySleep?date=2026-11-12`)
  })

  test('activities use start and limit', async () => {
    const { client, fetch } = setup({ responses: [json([{ activityId: 1 }])], stored: cachedRow })

    expect(await client.getActivities('alice', 0, 20)).toEqual([{ activityId: 1 }])
    expect(fetch.mock.calls[0]![0]).toBe(
      `${BASE}/activitylist-service/activities/search/activities?limit=20&start=0`,
    )
  })
})

describe('adaptPersonalSleep', () => {
  const startMs = Date.parse('2026-11-11T22:30:00Z')
  const endMs = Date.parse('2026-11-12T06:15:00Z')

  test.each([
    ['numbers', startMs, endMs],
    ['numeric strings', String(startMs), String(endMs)],
    ['ISO strings without a zone', '2026-11-11T22:30:00.0', '2026-11-12T06:15:00.0'],
    ['ISO strings with a zone', '2026-11-11T22:30:00Z', '2026-11-12T06:15:00Z'],
  ])('wraps a flat DTO with times as %s, normalised to epoch ms', (_, start, end) => {
    const dto = { calendarDate: '2026-11-12', sleepEndTimestampGMT: end, sleepStartTimestampGMT: start }
    expect(adaptPersonalSleep(dto)).toEqual({
      dailySleepDTO: {
        calendarDate: '2026-11-12',
        sleepEndTimestampGMT: endMs,
        sleepStartTimestampGMT: startMs,
      },
    })
  })

  test('passes an answer that is already wrapped through', () => {
    const wrapped = { dailySleepDTO: { calendarDate: '2026-11-12' }, sleepLevels: [] }
    expect(adaptPersonalSleep(wrapped)).toBe(wrapped)
  })

  test('leaves null alone', () => {
    expect(adaptPersonalSleep(null)).toBeNull()
  })
})
