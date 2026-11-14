import express, { type Request } from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import { createTokenBucketLimiter, RATE_LIMITS } from '../services/rate-limit.ts'
import {
  createClientIp,
  createRateLimits,
  isPublicAddress,
  mountRateLimits,
  trustProxySetting,
} from './rate-limit-middleware.ts'

const CLIENT = '203.0.113.7'

describe('trustProxySetting', () => {
  test('defaults to trusting the bundled nginx alone', () => {
    expect(trustProxySetting(undefined)).toBe('loopback')
    expect(trustProxySetting('  ')).toBe('loopback')
  })

  test('passes a hop count as a number and anything else as Express reads it', () => {
    expect(trustProxySetting('2')).toBe(2)
    expect(trustProxySetting('loopback, uniquelocal')).toBe('loopback, uniquelocal')
  })
})

test.each([
  [CLIENT, true],
  [`::ffff:${CLIENT}`, true],
  ['2001:db8::1', true],
  ['127.0.0.1', false],
  ['::ffff:127.0.0.1', false],
  ['::1', false],
  ['10.0.0.4', false],
  ['172.18.0.2', false],
  ['192.168.1.20', false],
  ['fd00::2', false],
])('isPublicAddress(%s) is %s', (ip, expected) => {
  expect(isPublicAddress(ip)).toBe(expected)
})

describe('createClientIp behind the bundled nginx (trust proxy loopback)', () => {
  const setup = () => {
    const warnings: string[] = []
    const clientIp = createClientIp((message) => warnings.push(message))
    const app = express()
    app.set('trust proxy', 'loopback')
    app.get('/', (req, res) => {
      res.json({ ip: clientIp(req) ?? null })
    })
    return { app, warnings }
  }

  test('takes the address nginx forwarded, not one the client forged before it', async () => {
    const { app } = setup()
    const res = await supertest(app).get('/').set('X-Forwarded-For', `198.51.100.9, ${CLIENT}`)
    expect(res.body).toEqual({ ip: CLIENT })
  })

  test('a request with no forwarded address has none to limit by', async () => {
    const { app, warnings } = setup()
    expect((await supertest(app).get('/')).body).toEqual({ ip: null })
    expect(warnings).toEqual([])
  })

  test('an untrusted proxy in front of nginx turns the IP limits off, and says so once', async () => {
    const { app, warnings } = setup()
    for (let i = 0; i < 2; i++) {
      const res = await supertest(app).get('/').set('X-Forwarded-For', `${CLIENT}, 172.18.0.2`)
      expect(res.body).toEqual({ ip: null })
    }
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('TRUST_PROXY')
  })

  test('trusting the proxy network finds the client again', async () => {
    const { app } = setup()
    app.set('trust proxy', 'loopback, uniquelocal')
    const res = await supertest(app).get('/').set('X-Forwarded-For', `${CLIENT}, 172.18.0.2`)
    expect(res.body).toEqual({ ip: CLIENT })
  })
})

describe('mountRateLimits', () => {
  const setup = () => {
    const app = express()
    const limits = createRateLimits({
      accountOf: (req) => req.get('authorization')?.slice('bearer '.length),
      clientIp: (req) => req.get('x-client-ip'),
      now: () => 0,
      uploadLimiter: createTokenBucketLimiter(RATE_LIMITS.uploads, () => 0),
    })
    mountRateLimits(app, limits)
    const ok = (_req: express.Request, res: express.Response) => {
      res.json({ success: true })
    }
    app.post('/signup', ok)
    app.post('/feed/images', ok)
    app.post('/metrics', ok)
    app.get('/public/:username/feed/:postId/chart.png', ok)
    return supertest(app)
  }

  const repeat = async (times: number, send: () => Promise<supertest.Response>) => {
    for (let i = 0; i < times; i++) expect((await send()).status).toBe(200)
  }

  test('signups per client IP answer 429 with Retry-After and the error shape', async () => {
    const http = setup()
    const signup = (ip: string) => http.post('/signup').set('X-Client-IP', ip)
    await repeat(RATE_LIMITS.signups.capacity, () => signup(CLIENT))

    const refused = await signup(CLIENT)
    expect(refused.status).toBe(429)
    expect(refused.headers['retry-after']).toBe('600')
    expect(refused.body).toEqual({ error: 'Too many requests. Try again in 600 seconds.', success: false })

    expect((await signup('198.51.100.9')).status).toBe(200)
  })

  test('public render endpoints are limited per client IP', async () => {
    const http = setup()
    const chart = () => http.get('/public/alice/feed/p1/chart.png').set('X-Client-IP', CLIENT)
    await repeat(RATE_LIMITS.public_reads.capacity, chart)
    expect((await chart()).status).toBe(429)
  })

  test('uploads are limited per account, whatever the IP', async () => {
    const http = setup()
    const upload = (account: string) => http.post('/feed/images').set('Authorization', `Bearer ${account}`)
    await repeat(RATE_LIMITS.uploads.capacity, () => upload('alice'))
    expect((await upload('alice')).status).toBe(429)
    expect((await upload('bob')).status).toBe(200)
  })

  test('without a client IP the per-IP limits stand aside', async () => {
    const http = setup()
    await repeat(RATE_LIMITS.signups.capacity + 1, () => http.post('/signup'))
  })

  test('authenticated API traffic other than uploads is not limited', async () => {
    const http = setup()
    await repeat(RATE_LIMITS.uploads.capacity + 10, () =>
      http.post('/metrics').set('Authorization', 'Bearer alice').set('X-Client-IP', CLIENT),
    )
  })
})

describe('failedLogins.begin', () => {
  const setup = (ip: string | undefined = CLIENT) => {
    let now = 0
    const { failedLogins } = createRateLimits({
      accountOf: () => undefined,
      clientIp: () => ip,
      now: () => now,
      uploadLimiter: createTokenBucketLimiter(RATE_LIMITS.uploads, () => now),
    })
    const begin = (username = 'alice') => failedLogins.begin({} as Request, username)
    const fail = (times: number, username = 'alice') => {
      for (let i = 0; i < times; i++) expect(begin(username).allowed).toBe(true)
    }
    return { advance: (ms: number) => void (now += ms), begin, fail }
  }
  const free = RATE_LIMITS.failed_logins_by_username.free_failures

  test('books the attempt at once, so a guess sent alongside an unfinished one past the free failures waits', () => {
    const { begin, fail } = setup()
    fail(free)
    const first = begin()
    expect(first.allowed).toBe(true)
    expect(begin()).toEqual({ allowed: false, retry_after_seconds: 1 })
  })

  test('an inconclusive attempt is taken back', () => {
    const { begin, fail } = setup()
    fail(free)
    const attempt = begin()
    if (!attempt.allowed) throw new Error('expected an allowed attempt')
    attempt.inconclusive()
    expect(begin().allowed).toBe(true)
  })

  test('a success clears the username and takes back its own booking from the IP', () => {
    const { begin, fail } = setup()
    fail(free)
    const attempt = begin()
    if (!attempt.allowed) throw new Error('expected an allowed attempt')
    attempt.succeeded()
    fail(free)
    expect(begin('bob').allowed).toBe(true)
  })

  test('the username is matched without case or surrounding spaces', () => {
    const { begin, fail } = setup(undefined)
    fail(free + 1, 'alice')
    expect(begin(' Alice ').allowed).toBe(false)
  })

  test('failures from one IP slow every username it tries, once past its own free failures', () => {
    const { begin } = setup()
    for (let i = 0; i <= RATE_LIMITS.failed_logins_by_ip.free_failures; i++) {
      expect(begin(`user${i}`).allowed).toBe(true)
    }
    expect(begin('someone_else').allowed).toBe(false)
  })
})
