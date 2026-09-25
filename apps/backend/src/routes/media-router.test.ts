import type { MediaPlay } from '@aurboda/api-spec'

import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import { createMediaRouter } from './media-router.ts'

const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
  req.user = 'tester'
  next()
}

const buildApp = (getPlays: (user: string, window: { start: Date; end: Date }) => Promise<MediaPlay[]>) => {
  const app = express()
  app.use(createMediaRouter(auth, getPlays) as unknown as express.RequestHandler)
  return app
}

describe('GET /plays', () => {
  test('returns the plays in the window', async () => {
    const getPlays = vi.fn().mockResolvedValue([])
    const res = await supertest(buildApp(getPlays))
      .get('/plays')
      .query({ end: '2026-01-11T00:00:00Z', start: '2026-01-10T00:00:00Z' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: [], success: true })
    expect(getPlays).toHaveBeenCalledWith('tester', {
      end: new Date('2026-01-11T00:00:00Z'),
      start: new Date('2026-01-10T00:00:00Z'),
    })
  })

  test('rejects a missing window', async () => {
    const getPlays = vi.fn()
    const res = await supertest(buildApp(getPlays)).get('/plays').query({ start: '2026-01-10T00:00:00Z' })

    expect(res.status).toBe(400)
    expect(getPlays).not.toHaveBeenCalled()
  })
})
