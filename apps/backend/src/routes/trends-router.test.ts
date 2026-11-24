import type { RequestHandler } from 'express'

import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { getTrend } from '../services/trends.ts'
import { createTrendsRouter } from './trends-router.ts'

vi.mock('../services/trends.ts', () => ({ getTrend: vi.fn() }))
vi.mock('../services/mutations.ts', () => ({ getCustomMetrics: vi.fn(async () => []) }))
vi.mock('../services/settings.ts', () => ({ getUserTimezone: vi.fn(async () => 'UTC') }))

const auth: RequestHandler = (req, _res, next) => {
  req.user = 'testuser'
  next()
}

const app = express()
app.use('/trends', createTrendsRouter(auth))

const trendResult = {
  aggregation: 'count' as const,
  current_value: 0,
  display_period: 'monthly' as const,
  display_unit: 'per month',
  half_life_days: 15,
  history: [],
  lookback_days: 90,
  pattern: '',
  source_type: 'journal' as const,
}

describe('GET /trends journal source', () => {
  beforeEach(() => {
    vi.mocked(getTrend).mockReset()
    vi.mocked(getTrend).mockResolvedValue(trendResult)
  })

  test('needs no pattern and passes the journal filters on', async () => {
    const res = await supertest(app).get(
      '/trends?source_type=journal&aggregation=sum&breakdown_fields=%40tags&journal_tags=travel&journal_q=sea',
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(getTrend).mock.calls[0]?.[1]).toMatchObject({
      aggregation: 'sum',
      breakdown_fields: ['@tags'],
      journal_q: 'sea',
      journal_tags: 'travel',
      source_type: 'journal',
    })
  })

  test.each([
    ['&breakdown_fields=mood', 'a journal breakdown is @tags or @people'],
    ['&measure=e1rm', 'measure and filter_field are for activity_type sources'],
    ['&aggregation=mean', 'a journal chart counts entries (count) or sums their words (sum)'],
    ['&journal_related_id=00000000-0000-4000-8000-000000000001', 'related_type and related_id go together'],
  ])('refuses %s with 400 without querying', async (params, error) => {
    const res = await supertest(app).get(`/trends?source_type=journal${params}`)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(error)
    expect(getTrend).not.toHaveBeenCalled()
  })

  test('refuses journal filters on another source, and still needs its pattern', async () => {
    const filtered = await supertest(app).get('/trends?source_type=metric&pattern=weight&journal_q=sea')
    expect(filtered.status).toBe(400)
    expect(filtered.body.error).toBe('journal_* filters need source_type journal')
    const noPattern = await supertest(app).get('/trends?source_type=metric')
    expect(noPattern.status).toBe(400)
    expect(noPattern.body.error).toBe('Either pattern or tag_definition_id is required')
    expect(getTrend).not.toHaveBeenCalled()
  })
})
