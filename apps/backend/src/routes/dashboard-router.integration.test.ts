import { type DashboardConfig, defaultDashboardConfig } from '@aurboda/api-spec'
import express from 'express'
import supertest from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getUserSettings, upsertUserSettings } from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { createDashboardRouter } from './dashboard-router.ts'

const CONTAINER_TIMEOUT = 120_000

const buildApp = (user: string) => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = user
    next()
  }
  app.use('/dashboard', createDashboardRouter(auth) as unknown as express.RequestHandler)
  return app
}

const custom: DashboardConfig = { sections: [], version: 1 }

describe('POST /dashboard/reset', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('removes the saved dashboard so the next read answers the default', async () => {
    const user = getTestUser()
    await upsertUserSettings(user, { birth_date: '1990-01-15' })
    const request = supertest(buildApp(user))

    expect((await request.put('/dashboard').send(custom)).status).toBe(200)
    expect((await request.get('/dashboard')).body.dashboard).toEqual(custom)

    const reset = await request.post('/dashboard/reset')
    expect(reset.status).toBe(200)
    expect(reset.body.dashboard).toEqual(defaultDashboardConfig)

    expect((await request.get('/dashboard')).body.dashboard).toEqual(defaultDashboardConfig)
    const settings = await getUserSettings(user)
    expect(settings?.dashboard).toBeUndefined()
    expect(settings?.birth_date).toBe('1990-01-15')
  })
})
