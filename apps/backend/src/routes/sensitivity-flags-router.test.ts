import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { SensitivityFlag } from '../db/sensitivities.ts'

import { createSensitivityFlagsRouter } from './sensitivity-flags-router.ts'

vi.mock('../db/index.ts', () => ({
  deleteSensitivityFlag: vi.fn(),
  insertSensitivityFlag: vi.fn(),
  listSensitivityFlags: vi.fn(),
  updateSensitivityFlag: vi.fn(),
}))

const dbBarrel = await import('../db/index.ts')

const flag = (name: string, overrides: Partial<SensitivityFlag> = {}): SensitivityFlag => ({
  id: '11111111-1111-4111-8111-111111111111',
  name,
  color: undefined,
  icon: undefined,
  sort_order: 0,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
})

const buildApp = () => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use('/sensitivity-flags', createSensitivityFlagsRouter(auth) as unknown as express.RequestHandler)
  return app
}

describe('GET /sensitivity-flags', () => {
  beforeEach(() => vi.clearAllMocks())

  test('returns the user list', async () => {
    vi.mocked(dbBarrel.listSensitivityFlags).mockResolvedValue([flag('dairy'), flag('gluten')])
    const res = await supertest(buildApp()).get('/sensitivity-flags')
    expect(res.status).toBe(200)
    expect(res.body.data.map((f: { name: string }) => f.name)).toEqual(['dairy', 'gluten'])
  })
})

describe('POST /sensitivity-flags', () => {
  beforeEach(() => vi.clearAllMocks())

  test('returns 201 with the new flag', async () => {
    vi.mocked(dbBarrel.insertSensitivityFlag).mockResolvedValue(flag('dairy'))
    const res = await supertest(buildApp()).post('/sensitivity-flags').send({ name: 'dairy' })
    expect(res.status).toBe(201)
    expect(res.body.data.name).toBe('dairy')
  })

  test('returns 409 on PG unique_violation (code 23505), not 500', async () => {
    const err = Object.assign(new Error('duplicate key value'), { code: '23505' })
    vi.mocked(dbBarrel.insertSensitivityFlag).mockRejectedValue(err)
    const res = await supertest(buildApp()).post('/sensitivity-flags').send({ name: 'dairy' })
    expect(res.status).toBe(409)
  })

  test('returns 500 on unrelated errors', async () => {
    vi.mocked(dbBarrel.insertSensitivityFlag).mockRejectedValue(new Error('db down'))
    const res = await supertest(buildApp()).post('/sensitivity-flags').send({ name: 'dairy' })
    expect(res.status).toBe(500)
  })
})

describe('PATCH /sensitivity-flags/:id', () => {
  const id = '11111111-1111-4111-8111-111111111111'

  beforeEach(() => vi.clearAllMocks())

  test('200 with the updated flag', async () => {
    vi.mocked(dbBarrel.updateSensitivityFlag).mockResolvedValue(flag('dairy', { color: '#fff' }))
    const res = await supertest(buildApp()).patch(`/sensitivity-flags/${id}`).send({ color: '#fff' })
    expect(res.status).toBe(200)
    expect(res.body.data.color).toBe('#fff')
  })

  test('404 when the flag is missing', async () => {
    vi.mocked(dbBarrel.updateSensitivityFlag).mockResolvedValue(null)
    const res = await supertest(buildApp()).patch(`/sensitivity-flags/${id}`).send({ name: 'x' })
    expect(res.status).toBe(404)
  })

  test('409 on PG unique_violation', async () => {
    const err = Object.assign(new Error('dup'), { code: '23505' })
    vi.mocked(dbBarrel.updateSensitivityFlag).mockRejectedValue(err)
    const res = await supertest(buildApp()).patch(`/sensitivity-flags/${id}`).send({ name: 'dup' })
    expect(res.status).toBe(409)
  })
})

describe('DELETE /sensitivity-flags/:id', () => {
  const id = '11111111-1111-4111-8111-111111111111'

  beforeEach(() => vi.clearAllMocks())

  test('200 on success', async () => {
    vi.mocked(dbBarrel.deleteSensitivityFlag).mockResolvedValue(true)
    const res = await supertest(buildApp()).delete(`/sensitivity-flags/${id}`)
    expect(res.status).toBe(200)
  })

  test('404 when the flag does not exist', async () => {
    vi.mocked(dbBarrel.deleteSensitivityFlag).mockResolvedValue(false)
    const res = await supertest(buildApp()).delete(`/sensitivity-flags/${id}`)
    expect(res.status).toBe(404)
  })
})
