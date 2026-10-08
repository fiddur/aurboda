import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import { createTracksRouter } from './tracks-router.ts'

describe('POST /tracks/backfill', () => {
  test('backfills the caller and returns the counts', async () => {
    const deps = {
      getGarminCandidates: vi.fn(async () => []),
      getStravaCandidates: vi.fn(async () => []),
      upsertActivityTrack: vi.fn(async () => undefined),
    }
    const app = express()
    const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      req.user = 'tester'
      next()
    }
    app.use('/tracks', createTracksRouter(auth, deps) as unknown as express.RequestHandler)

    const res = await supertest(app).post('/tracks/backfill')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: { garmin: 0, skipped: 0, strava: 0 }, success: true })
    expect(deps.getGarminCandidates).toHaveBeenCalledWith('tester', { after: undefined, limit: 50 })
  })
})
