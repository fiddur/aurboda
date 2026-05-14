/**
 * Focused router tests for the new /meals/period-summary endpoint —
 * validation refinements (start ≤ end, window cap) and happy-path JSON
 * shape. The other meal endpoints have integration coverage via
 * services/meals.ts and the front-end hooks; we only cover the new surface
 * area here.
 */
import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createMealsRouter } from './meals-router.ts'

vi.mock('../services/meals.ts', () => ({
  addMeal: vi.fn(),
  deleteMealById: vi.fn(),
  getMeal: vi.fn(),
  queryFrequentFoodItems: vi.fn(),
  queryFrequentMeals: vi.fn(),
  queryMeals: vi.fn(),
  updateMealById: vi.fn(),
}))

vi.mock('../services/queries/meal-period-summary.ts', () => ({
  getMealPeriodSummary: vi.fn(),
}))

vi.mock('../db/index.ts', () => ({
  getMealLogCompleted: vi.fn().mockResolvedValue([]),
  setMealLogCompleted: vi.fn(),
  unsetMealLogCompleted: vi.fn(),
}))

const periodSvc = await import('../services/queries/meal-period-summary.ts')

const buildApp = () => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use('/meals', createMealsRouter(auth) as unknown as express.RequestHandler)
  return app
}

describe('GET /meals/period-summary', () => {
  beforeEach(() => vi.clearAllMocks())

  test('returns the summary payload with nutrients + calories_burned', async () => {
    vi.mocked(periodSvc.getMealPeriodSummary).mockResolvedValue({
      start: '2025-01-01',
      end: '2025-01-07',
      days_in_range: 7,
      days_with_meals: 7,
      days_completed: 7,
      nutrients: { calories: { avg: 2100, total: 14_700, days_with_value: 7 } },
      calories_burned: { avg: 2400, days_with_data: 7 },
    })
    const res = await supertest(buildApp()).get('/meals/period-summary?start=2025-01-01&end=2025-01-07')
    expect(res.status).toBe(200)
    expect(res.body.data.days_in_range).toBe(7)
    expect(res.body.data.nutrients.calories.avg).toBe(2100)
    expect(res.body.data.calories_burned.avg).toBe(2400)
    expect(periodSvc.getMealPeriodSummary).toHaveBeenCalledWith(
      'tester',
      expect.objectContaining({ end: '2025-01-07', start: '2025-01-01' }),
    )
  })

  test('passes through the optional tz query', async () => {
    vi.mocked(periodSvc.getMealPeriodSummary).mockResolvedValue({
      start: '2025-01-01',
      end: '2025-01-01',
      days_in_range: 1,
      days_with_meals: 0,
      days_completed: 0,
      nutrients: {},
      calories_burned: null,
    })
    await supertest(buildApp()).get(
      '/meals/period-summary?start=2025-01-01&end=2025-01-01&tz=Europe%2FStockholm',
    )
    expect(periodSvc.getMealPeriodSummary).toHaveBeenCalledWith(
      'tester',
      expect.objectContaining({ tz: 'Europe/Stockholm' }),
    )
  })

  test('passes through count_only_completed=true', async () => {
    vi.mocked(periodSvc.getMealPeriodSummary).mockResolvedValue({
      start: '2025-01-01',
      end: '2025-01-07',
      days_in_range: 7,
      days_with_meals: 3,
      days_completed: 3,
      nutrients: {},
      calories_burned: null,
    })
    await supertest(buildApp()).get(
      '/meals/period-summary?start=2025-01-01&end=2025-01-07&count_only_completed=true',
    )
    expect(periodSvc.getMealPeriodSummary).toHaveBeenCalledWith(
      'tester',
      expect.objectContaining({ count_only_completed: true }),
    )
  })

  test('count_only_completed=false stays falsy', async () => {
    vi.mocked(periodSvc.getMealPeriodSummary).mockResolvedValue({
      start: '2025-01-01',
      end: '2025-01-07',
      days_in_range: 7,
      days_with_meals: 7,
      days_completed: 0,
      nutrients: {},
      calories_burned: null,
    })
    await supertest(buildApp()).get(
      '/meals/period-summary?start=2025-01-01&end=2025-01-07&count_only_completed=false',
    )
    expect(periodSvc.getMealPeriodSummary).toHaveBeenCalledWith(
      'tester',
      expect.objectContaining({ count_only_completed: false }),
    )
  })

  test('400 when start > end', async () => {
    const res = await supertest(buildApp()).get('/meals/period-summary?start=2025-02-01&end=2025-01-01')
    expect(res.status).toBe(400)
    expect(periodSvc.getMealPeriodSummary).not.toHaveBeenCalled()
  })

  test('400 when window exceeds the cap', async () => {
    const res = await supertest(buildApp()).get('/meals/period-summary?start=2024-01-01&end=2025-12-31')
    expect(res.status).toBe(400)
    expect(periodSvc.getMealPeriodSummary).not.toHaveBeenCalled()
  })

  test('400 when start is malformed', async () => {
    const res = await supertest(buildApp()).get('/meals/period-summary?start=yesterday&end=2025-01-01')
    expect(res.status).toBe(400)
  })

  test('400 when end is missing', async () => {
    const res = await supertest(buildApp()).get('/meals/period-summary?start=2025-01-01')
    expect(res.status).toBe(400)
  })
})
