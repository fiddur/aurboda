import express from 'express'
import supertest from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getCustomMetricByName, insertCustomMetricDefinition } from '../db/custom-metrics.ts'
import { upsertUserSettings } from '../db/index.ts'
import { insertTimeSeries } from '../db/time-series.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { createMetricsRouter } from './metrics-router.ts'

const CONTAINER_TIMEOUT = 120_000

const buildApp = (user: string) => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = user
    next()
  }
  app.use(createMetricsRouter(auth) as unknown as express.RequestHandler)
  return app
}

describe('PATCH /metrics/custom/:name', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('persists min_value and max_value, and null clears them', async () => {
    const user = getTestUser()
    await insertCustomMetricDefinition(user, { name: 'mood', unit: 'score' })
    const request = supertest(buildApp(user))

    const set = await request.patch('/metrics/custom/mood').send({ max_value: 10, min_value: 1 })
    expect(set.status).toBe(200)
    expect(await getCustomMetricByName(user, 'mood')).toMatchObject({ max_value: 10, min_value: 1 })

    const cleared = await request.patch('/metrics/custom/mood').send({ min_value: null })
    expect(cleared.status).toBe(200)
    const metric = await getCustomMetricByName(user, 'mood')
    expect(metric?.min_value).toBeUndefined()
    expect(metric?.max_value).toBe(10)
  })
})

describe('GET /daily-summary', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  // 06:30 on 3 Nov in Tokyo, still 2 Nov in UTC
  const seedTokyoMorningSteps = (user: string) =>
    insertTimeSeries(user, [
      { metric: 'steps', source: 'aurboda', time: new Date('2026-11-02T21:30:00Z'), value: 12345 },
    ])

  test('counts the day in the tz query parameter', async () => {
    const user = getTestUser()
    await seedTokyoMorningSteps(user)

    const res = await supertest(buildApp(user)).get('/daily-summary?date=2026-11-03&tz=Asia/Tokyo')
    expect(res.status).toBe(200)
    expect(res.body.data.steps.total).toBe(12345)
  })

  test('uses the UTC day without tz or a stored timezone', async () => {
    const user = getTestUser()
    await seedTokyoMorningSteps(user)

    const res = await supertest(buildApp(user)).get('/daily-summary?date=2026-11-03')
    expect(res.status).toBe(200)
    expect(res.body.data.steps.total).toBe(0)
  })

  test("falls back to the user's stored device_timezone", async () => {
    const user = getTestUser()
    await seedTokyoMorningSteps(user)
    await upsertUserSettings(user, { device_timezone: 'Asia/Tokyo' })

    const res = await supertest(buildApp(user)).get('/daily-summary?date=2026-11-03')
    expect(res.status).toBe(200)
    expect(res.body.data.steps.total).toBe(12345)
  })

  test('rejects an unknown tz with 400', async () => {
    const user = getTestUser()

    const res = await supertest(buildApp(user)).get('/daily-summary?date=2026-11-03&tz=Not/AZone')
    expect(res.status).toBe(400)
  })
})
