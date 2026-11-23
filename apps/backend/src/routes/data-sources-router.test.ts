import express, { type RequestHandler } from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../services/data-sources-overview.ts', () => ({ getDataSourcesOverview: vi.fn() }))

const { getDataSourcesOverview } = await import('../services/data-sources-overview.ts')
const { createDataSourcesRouter } = await import('./data-sources-router.ts')

const asAlice: RequestHandler = (req, _res, next) => {
  req.user = 'alice'
  next()
}

const app = () => {
  const a = express()
  a.use('/data-sources', createDataSourcesRouter(asAlice) as unknown as express.RequestHandler)
  return supertest(a)
}

describe('GET /data-sources/overview', () => {
  test("answers the signed-in user's overview", async () => {
    const overview = {
      groups: [{ id: 'location' as const, label: 'Location' }],
      kinds: [],
      sources: [],
    }
    vi.mocked(getDataSourcesOverview).mockResolvedValue(overview)

    const res = await app().get('/data-sources/overview')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...overview, success: true })
    expect(getDataSourcesOverview).toHaveBeenCalledWith('alice')
  })
})
