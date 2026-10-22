import type { RequestHandler } from 'express'

import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { getChartData } from '../services/chart-data.ts'
import { createChartDataRouter } from './chart-data-router.ts'

vi.mock('../services/chart-data.ts', () => ({ getChartData: vi.fn() }))

const auth: RequestHandler = (req, _res, next) => {
  req.user = 'testuser'
  next()
}

const app = express()
app.use('/chart-data', createChartDataRouter(auth))

const base =
  '/chart-data?source_type=metric&pattern=weight&start=2026-03-01T00:00:00Z&end=2026-04-01T00:00:00Z'

describe('GET /chart-data tz', () => {
  beforeEach(() => {
    vi.mocked(getChartData).mockReset()
    vi.mocked(getChartData).mockResolvedValue({ buckets: [] })
  })

  test('passes a valid IANA zone to the service', async () => {
    const res = await supertest(app).get(`${base}&tz=Europe/Stockholm`)
    expect(res.status).toBe(200)
    expect(vi.mocked(getChartData).mock.calls[0]![1].tz).toBe('Europe/Stockholm')
  })

  test('leaves tz undefined when absent (the service defaults to UTC)', async () => {
    const res = await supertest(app).get(base)
    expect(res.status).toBe(200)
    expect(vi.mocked(getChartData).mock.calls[0]![1].tz).toBeUndefined()
  })

  test('accepts UTC', async () => {
    const res = await supertest(app).get(`${base}&tz=UTC`)
    expect(res.status).toBe(200)
  })

  test('rejects an unknown zone with 400 without querying', async () => {
    const res = await supertest(app).get(`${base}&tz=Mars/Olympus_Mons`)
    expect(res.status).toBe(400)
    expect(getChartData).not.toHaveBeenCalled()
  })
})
