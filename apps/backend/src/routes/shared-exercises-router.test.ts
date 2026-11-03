import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as DbModule from '../db/index.ts'
import type { SharedExerciseRecord } from '../db/index.ts'

vi.mock('../db/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  createSharedExercise: vi.fn(),
  deleteSharedExercise: vi.fn(),
  getSharedExerciseById: vi.fn(),
  listSharedExercises: vi.fn(),
  updateSharedExercise: vi.fn(),
}))

const db = await import('../db/index.ts')
const { createSharedExercisesRouter } = await import('./shared-exercises-router.ts')

const record: SharedExerciseRecord = {
  activity_type: 'strength_training',
  created_at: new Date('2026-10-01T10:00:00.000Z'),
  field: 'sets.exercise',
  id: '11111111-1111-4111-8111-111111111111',
  is_public: false,
  name: 'Bench Press',
  slug: 'abc123',
  updated_at: new Date('2026-10-02T10:00:00.000Z'),
  value: 'Bench Press',
}

const buildApp = () => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'alice'
    next()
  }
  app.use(
    '/shared-exercises',
    createSharedExercisesRouter(auth, 'https://aurboda.net') as unknown as express.RequestHandler,
  )
  return supertest(app)
}

describe('shared exercises router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('lists the shares with their absolute URL and visibility', async () => {
    vi.mocked(db.listSharedExercises).mockResolvedValue([record])
    const res = await buildApp().get('/shared-exercises')
    expect(res.status).toBe(200)
    expect(res.body.exercises).toEqual([
      {
        activity_type: 'strength_training',
        created_at: '2026-10-01T10:00:00.000Z',
        field: 'sets.exercise',
        id: record.id,
        name: 'Bench Press',
        share_url: 'https://aurboda.net/u/alice/abc123',
        slug: 'abc123',
        updated_at: '2026-10-02T10:00:00.000Z',
        value: 'Bench Press',
        visibility: 'unlisted',
      },
    ])
  })

  test('creates an unlisted share named after the value by default', async () => {
    vi.mocked(db.createSharedExercise).mockResolvedValue(record)
    const res = await buildApp()
      .post('/shared-exercises')
      .send({ activity_type: 'strength_training', field: 'sets.exercise', value: 'Bench Press' })
    expect(res.status).toBe(200)
    expect(db.createSharedExercise).toHaveBeenCalledWith('alice', {
      activity_type: 'strength_training',
      field: 'sets.exercise',
      is_public: false,
      name: 'Bench Press',
      value: 'Bench Press',
    })
    expect(res.body.exercise.slug).toBe('abc123')
  })

  test('answers 409 when the item is already shared', async () => {
    vi.mocked(db.createSharedExercise).mockRejectedValue(
      Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'shared_exercises_item_key' }),
    )
    const res = await buildApp()
      .post('/shared-exercises')
      .send({ activity_type: 'strength_training', field: 'sets.exercise', value: 'Bench Press' })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'This exercise is already shared', success: false })
  })

  test('rejects an invalid item path', async () => {
    const res = await buildApp()
      .post('/shared-exercises')
      .send({ activity_type: 'strength_training', field: 'Sets Exercise', value: 'Bench Press' })
    expect(res.status).toBe(400)
    expect(db.createSharedExercise).not.toHaveBeenCalled()
  })

  test('updates the name and visibility', async () => {
    vi.mocked(db.updateSharedExercise).mockResolvedValue({ ...record, is_public: true, name: 'My bench' })
    const res = await buildApp()
      .put(`/shared-exercises/${record.id}`)
      .send({ name: 'My bench', visibility: 'public' })
    expect(res.status).toBe(200)
    expect(db.updateSharedExercise).toHaveBeenCalledWith('alice', record.id, {
      is_public: true,
      name: 'My bench',
    })
    expect(res.body.exercise.visibility).toBe('public')
  })

  test('answers 404 for a missing share', async () => {
    vi.mocked(db.getSharedExerciseById).mockResolvedValue(null)
    vi.mocked(db.updateSharedExercise).mockResolvedValue(null)
    vi.mocked(db.deleteSharedExercise).mockResolvedValue(false)
    const app = buildApp()
    expect((await app.get(`/shared-exercises/${record.id}`)).status).toBe(404)
    expect((await app.put(`/shared-exercises/${record.id}`).send({ name: 'x' })).status).toBe(404)
    expect((await app.delete(`/shared-exercises/${record.id}`)).status).toBe(404)
  })

  test('deletes a share', async () => {
    vi.mocked(db.deleteSharedExercise).mockResolvedValue(true)
    const res = await buildApp().delete(`/shared-exercises/${record.id}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
  })
})
