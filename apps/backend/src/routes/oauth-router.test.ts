import express from 'express'
import supertest from 'supertest'
import { expect, test } from 'vitest'

import { createRateLimits } from '../api/rate-limit-middleware.ts'
import { createTokenBucketLimiter, RATE_LIMITS } from '../services/rate-limit.ts'
import { createOAuthRouter } from './oauth-router.ts'

const badPassword = () => new Error('password authentication failed for user "alice"')

const setup = (loginToUserDb: (username: string, password: string) => Promise<unknown>) => {
  const now = () => 0
  const { failedLogins } = createRateLimits({
    accountOf: () => undefined,
    clientIp: () => '203.0.113.7',
    now,
    uploadLimiter: createTokenBucketLimiter(RATE_LIMITS.uploads, now),
  })
  const app = express().use(
    createOAuthRouter({
      centralDb: {} as never,
      failedLogins,
      loginToUserDb,
      webHost: 'https://aurboda.test',
    }),
  )
  return () =>
    supertest(app).post('/authorize').type('form').send({
      client_id: 'c',
      code_challenge: 'x',
      code_challenge_method: 'S256',
      password: 'wrong',
      redirect_uri: 'https://client.test/cb',
      username: 'alice',
    })
}

test('the sign-in form slows down a username after repeated wrong passwords', async () => {
  const attempts: string[] = []
  const signIn = setup(async (_username, password) => {
    attempts.push(password)
    throw badPassword()
  })

  for (let i = 0; i <= RATE_LIMITS.failed_logins_by_username.free_failures; i++) {
    const res = await signIn()
    expect(res.status).toBe(200)
    expect(res.text).toContain('Invalid username or password')
  }

  const slowed = await signIn()
  expect(slowed.status).toBe(429)
  expect(slowed.headers['retry-after']).toBe('1')
  expect(slowed.text).toContain('Too many failed sign-in attempts. Try again in 1 second.')
  expect(attempts).toHaveLength(RATE_LIMITS.failed_logins_by_username.free_failures + 1)
})

test('guesses sent together past the free failures do not all reach the password check', async () => {
  let calls = 0
  let rejectPending: (err: Error) => void = () => {}
  let reached: () => void = () => {}
  const pendingReached = new Promise<void>((resolve) => (reached = resolve))
  const signIn = setup(async () => {
    calls++
    if (calls <= RATE_LIMITS.failed_logins_by_username.free_failures) throw badPassword()
    return new Promise((_resolve, reject) => {
      rejectPending = reject
      reached()
    })
  })
  for (let i = 0; i < RATE_LIMITS.failed_logins_by_username.free_failures; i++) {
    expect((await signIn()).status).toBe(200)
  }

  const first = signIn().then((r) => r)
  await pendingReached
  expect((await signIn()).status).toBe(429)
  rejectPending(badPassword())
  expect((await first).text).toContain('Invalid username or password')
  expect(calls).toBe(RATE_LIMITS.failed_logins_by_username.free_failures + 1)
})
