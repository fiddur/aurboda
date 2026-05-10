import type { NutrientRecommendation } from '@aurboda/api-spec'

import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createNutrientRecommendationsRouter } from './nutrient-recommendations-router.ts'

vi.mock('../services/nutrient-recommendations.ts', () => ({
  clearUserNutrientRecommendation: vi.fn(),
  getEffectiveRecommendations: vi.fn(),
  setUserNutrientRecommendation: vi.fn(),
}))

const svc = await import('../services/nutrient-recommendations.ts')

const rec = (overrides: Partial<NutrientRecommendation> = {}): NutrientRecommendation => ({
  nutrient_name: 'protein',
  recommended_low: 50,
  recommended_high: 100,
  unit: 'g',
  source: 'central',
  source_label: 'NNR2023 2023',
  ...overrides,
})

const buildApp = () => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use(
    '/nutrient-recommendations',
    createNutrientRecommendationsRouter(auth) as unknown as express.RequestHandler,
  )
  return app
}

describe('GET /nutrient-recommendations', () => {
  beforeEach(() => vi.clearAllMocks())

  test('returns the merged effective list', async () => {
    vi.mocked(svc.getEffectiveRecommendations).mockResolvedValue([
      rec(),
      rec({ nutrient_name: 'salt', recommended_low: null, recommended_high: 6, unit: 'g' }),
    ])
    const res = await supertest(buildApp()).get('/nutrient-recommendations')
    expect(res.status).toBe(200)
    expect(res.body.recommendations).toHaveLength(2)
    expect(res.body.recommendations[0].nutrient_name).toBe('protein')
  })
})

describe('PUT /nutrient-recommendations/:nutrient_name', () => {
  beforeEach(() => vi.clearAllMocks())

  test('200 with the merged effective record on success', async () => {
    vi.mocked(svc.setUserNutrientRecommendation).mockResolvedValue(
      rec({ recommended_low: 80, recommended_high: 200, source: 'user' }),
    )
    const res = await supertest(buildApp())
      .put('/nutrient-recommendations/protein')
      .send({ recommended_low: 80, recommended_high: 200 })
    expect(res.status).toBe(200)
    expect(res.body.data.source).toBe('user')
    expect(res.body.data.recommended_low).toBe(80)
    expect(svc.setUserNutrientRecommendation).toHaveBeenCalledWith(
      'tester',
      'protein',
      expect.objectContaining({ recommended_low: 80, recommended_high: 200 }),
    )
  })

  test('accepts explicit null to suppress one bound', async () => {
    vi.mocked(svc.setUserNutrientRecommendation).mockResolvedValue(
      rec({ recommended_low: null, recommended_high: 5, source: 'user' }),
    )
    const res = await supertest(buildApp())
      .put('/nutrient-recommendations/salt')
      .send({ recommended_high: 5, recommended_low: null })
    expect(res.status).toBe(200)
    expect(res.body.data.recommended_low).toBeNull()
  })

  test('400 when neither bound is supplied', async () => {
    const res = await supertest(buildApp()).put('/nutrient-recommendations/protein').send({})
    expect(res.status).toBe(400)
    expect(svc.setUserNutrientRecommendation).not.toHaveBeenCalled()
  })

  test('500 if the service can’t resolve effective state', async () => {
    vi.mocked(svc.setUserNutrientRecommendation).mockResolvedValue(null)
    const res = await supertest(buildApp())
      .put('/nutrient-recommendations/protein')
      .send({ recommended_low: 80 })
    expect(res.status).toBe(500)
  })
})

describe('DELETE /nutrient-recommendations/:nutrient_name', () => {
  beforeEach(() => vi.clearAllMocks())

  test('200 with the post-clear effective record (the central default)', async () => {
    vi.mocked(svc.clearUserNutrientRecommendation).mockResolvedValue({
      cleared: true,
      effective: rec(),
    })
    const res = await supertest(buildApp()).delete('/nutrient-recommendations/protein')
    expect(res.status).toBe(200)
    expect(res.body.data.source).toBe('central')
  })

  test('200 with no data when nothing remains after clear', async () => {
    vi.mocked(svc.clearUserNutrientRecommendation).mockResolvedValue({ cleared: false, effective: null })
    const res = await supertest(buildApp()).delete('/nutrient-recommendations/unknown_nutrient')
    expect(res.status).toBe(200)
    expect(res.body.data).toBeUndefined()
  })
})
