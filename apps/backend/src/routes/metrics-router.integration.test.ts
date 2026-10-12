import express from 'express'
import supertest from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getCustomMetricByName, insertCustomMetricDefinition } from '../db/custom-metrics.ts'
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
