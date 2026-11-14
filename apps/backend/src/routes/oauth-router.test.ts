import express from 'express'
import supertest from 'supertest'
import { expect, test } from 'vitest'

import { createRateLimits } from '../api/rate-limit-middleware.ts'
import { createTokenBucketLimiter, RATE_LIMITS } from '../services/rate-limit.ts'
import { createOAuthRouter } from './oauth-router.ts'

test('the sign-in form slows down a username after repeated wrong passwords', async () => {
  const now = () => 0
  const { failedLogins } = createRateLimits({
    accountOf: () => undefined,
    clientIp: () => '203.0.113.7',
    now,
    uploadLimiter: createTokenBucketLimiter(RATE_LIMITS.uploads, now),
  })
  const attempts: string[] = []
  const router = createOAuthRouter({
    centralDb: {} as never,
    failedLogins,
    loginToUserDb: async (_username, password) => {
      attempts.push(password)
      throw new Error('password authentication failed for user "alice"')
    },
    webHost: 'https://aurboda.test',
  })
  const signIn = () =>
    supertest(express().use(router)).post('/authorize').type('form').send({
      client_id: 'c',
      code_challenge: 'x',
      code_challenge_method: 'S256',
      password: 'wrong',
      redirect_uri: 'https://client.test/cb',
      username: 'alice',
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
