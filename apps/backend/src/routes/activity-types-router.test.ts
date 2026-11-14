import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createActivityTypesRouter } from './activity-types-router.ts'

vi.mock('../services/activity-type-definitions.ts', () => ({
  addActivityTypeDefinition: vi.fn(),
  deleteActivityTypeDefinition: vi.fn(),
  listActivityTypeDefinitions: vi.fn(),
  mergeActivityType: vi.fn(),
  renameActivityTypeDefinition: vi.fn(),
  updateActivityTypeDefinition: vi.fn(),
}))

vi.mock('../services/queries/index.ts', async () => {
  const { sessionsOptionsFromQuery } = await import('../services/queries/activity-sessions.ts')
  return {
    getActivityTypeSummary: vi.fn(),
    queryActivityFieldValues: vi.fn(),
    queryActivitySessions: vi.fn(),
    sessionsOptionsFromQuery,
  }
})

vi.mock('../services/item-value-aliases.ts', () => ({
  deleteAlias: vi.fn(),
  listAliases: vi.fn(),
  mergeItemValues: vi.fn(),
}))

vi.mock('../services/item-value-identities.ts', () => ({
  clearItemValueIdentity: vi.fn(),
  getItemValueIdentity: vi.fn(),
  listUnmappedItemValues: vi.fn(),
  setItemValueIdentity: vi.fn(),
}))

vi.mock('../services/activity-records.ts', () => ({ getActivityRecords: vi.fn() }))

vi.mock('../db/index.ts', () => ({}))

const queries = await import('../services/queries/index.ts')
const service = await import('../services/activity-type-definitions.ts')
const aliases = await import('../services/item-value-aliases.ts')
const records = await import('../services/activity-records.ts')
const identities = await import('../services/item-value-identities.ts')

const buildApp = () => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use('/activity-types', createActivityTypesRouter(auth) as unknown as express.RequestHandler)
  return app
}

describe('GET /activity-types/:name/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queries.queryActivitySessions).mockResolvedValue({ activity_type: 'yoga', sessions: [] })
  })

  test('maps the query onto the service options', async () => {
    const res = await supertest(buildApp()).get('/activity-types/yoga/sessions').query({
      filter_field: 'session_name',
      filter_value: 'Mobility Flow, with Ember',
      group_by: 'session_name',
      start: '2026-01-01T00:00:00Z',
    })

    expect(res.status).toBe(200)
    expect(queries.queryActivitySessions).toHaveBeenCalledWith('tester', 'yoga', {
      end: undefined,
      filter: { field: 'session_name', value: 'Mobility Flow, with Ember' },
      groupBy: 'session_name',
      start: new Date('2026-01-01T00:00:00Z'),
    })
  })

  test('400s on a filter field without a value', async () => {
    const res = await supertest(buildApp()).get('/activity-types/yoga/sessions?filter_field=session_name')

    expect(res.status).toBe(400)
    expect(queries.queryActivitySessions).not.toHaveBeenCalled()
  })
})

describe('GET /activity-types/:name/records', () => {
  beforeEach(() => vi.clearAllMocks())

  test('returns the records for the filter and start', async () => {
    const data = {
      activity_type: 'strength_training',
      records: [
        {
          measure: 'e1rm' as const,
          session_id: 'a1',
          set: { reps: 3, weight: 90 },
          start_time: '2026-03-01T08:00:00.000Z',
          value: 99,
        },
      ],
    }
    vi.mocked(records.getActivityRecords).mockResolvedValue(data)

    const res = await supertest(buildApp()).get('/activity-types/strength_training/records').query({
      filter_field: 'sets.exercise',
      filter_value: 'Bench Press',
      start: '2026-01-01T00:00:00Z',
    })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data, success: true })
    expect(records.getActivityRecords).toHaveBeenCalledWith('tester', 'strength_training', {
      filter_field: 'sets.exercise',
      filter_value: 'Bench Press',
      start: '2026-01-01T00:00:00Z',
    })
  })

  test('400s on a filter field without a value', async () => {
    const res = await supertest(buildApp()).get(
      '/activity-types/strength_training/records?filter_field=sets.exercise',
    )

    expect(res.status).toBe(400)
    expect(records.getActivityRecords).not.toHaveBeenCalled()
  })
})

describe('GET /activity-types/:name/summary', () => {
  beforeEach(() => vi.clearAllMocks())

  test('returns the summary for the range and filter', async () => {
    const data = {
      activity_type_name: 'Running',
      avg_speed_kmh: 10,
      best_pace_sec_per_km: 330,
      count: 4,
      distance_km: 32,
      sleep: null,
      total_minutes: 192,
    }
    vi.mocked(queries.getActivityTypeSummary).mockResolvedValue(data)
    const query = {
      end: '2026-10-31T23:59:59Z',
      filter_field: 'run_kind',
      filter_value: 'intervals',
      start: '2026-10-01T00:00:00Z',
    }

    const res = await supertest(buildApp()).get('/activity-types/running/summary').query(query)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data, success: true })
    expect(queries.getActivityTypeSummary).toHaveBeenCalledWith('tester', 'running', query)
  })

  test('400s without a range or on a filter field without a value', async () => {
    const app = buildApp()
    expect((await supertest(app).get('/activity-types/running/summary')).status).toBe(400)
    expect(
      (
        await supertest(app).get('/activity-types/running/summary').query({
          end: '2026-10-31T23:59:59Z',
          filter_field: 'run_kind',
          start: '2026-10-01T00:00:00Z',
        })
      ).status,
    ).toBe(400)
    expect(queries.getActivityTypeSummary).not.toHaveBeenCalled()
  })
})

describe('GET /activity-types/:name/field-values', () => {
  beforeEach(() => vi.clearAllMocks())

  test('returns the values of the field', async () => {
    const data = {
      activity_type: 'yoga',
      field: 'session_name',
      values: [{ count: 2, last_used: '2026-10-01T07:00:00.000Z', value: 'Flow' }],
    }
    vi.mocked(queries.queryActivityFieldValues).mockResolvedValue(data)

    const res = await supertest(buildApp()).get('/activity-types/yoga/field-values?field=session_name')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data, success: true })
    expect(queries.queryActivityFieldValues).toHaveBeenCalledWith('tester', 'yoga', 'session_name')
  })

  test('400s on a missing or malformed field name', async () => {
    const app = buildApp()
    expect((await supertest(app).get('/activity-types/yoga/field-values')).status).toBe(400)
    expect((await supertest(app).get("/activity-types/yoga/field-values?field=a'b")).status).toBe(400)
    expect(queries.queryActivityFieldValues).not.toHaveBeenCalled()
  })
})

describe('POST /activity-types', () => {
  beforeEach(() => vi.clearAllMocks())

  test('passes aliases through to the service', async () => {
    vi.mocked(service.addActivityTypeDefinition).mockResolvedValue({
      data: {
        aliases: ['sauna', 'bastu'],
        color: '#6b7280',
        display_category: 'other',
        display_name: 'Sauna',
        is_builtin: false,
        name: 'sauna',
        show_on_timeline: true,
      },
      success: true,
    })

    const res = await supertest(buildApp())
      .post('/activity-types')
      .send({ aliases: ['bastu'], display_category: 'other', display_name: 'Sauna', name: 'sauna' })

    expect(res.status).toBe(201)
    expect(service.addActivityTypeDefinition).toHaveBeenCalledWith(
      'tester',
      expect.objectContaining({ aliases: ['bastu'], name: 'sauna' }),
    )
  })

  test('passes parent_type and show_on_timeline through and answers with them (#1220)', async () => {
    vi.mocked(service.addActivityTypeDefinition).mockImplementation(async (_user, input) => ({
      data: {
        aliases: [input.name],
        color: '#6b7280',
        display_category: input.display_category ?? 'other',
        display_name: input.display_name ?? input.name,
        is_builtin: false,
        name: input.name,
        parent_type: input.parent_type,
        show_on_timeline: input.show_on_timeline ?? true,
      },
      success: true,
    }))
    const body = {
      display_category: 'exercise',
      display_name: 'Yin Yoga',
      name: 'yoga_yin',
      parent_type: 'yoga',
      show_on_timeline: false,
    }

    const res = await supertest(buildApp()).post('/activity-types').send(body)

    expect(res.status).toBe(201)
    expect(service.addActivityTypeDefinition).toHaveBeenCalledWith('tester', body)
    expect(res.body.data).toMatchObject({ parent_type: 'yoga', show_on_timeline: false })
  })

  test('accepts a catalogue name alone (#1700)', async () => {
    vi.mocked(service.addActivityTypeDefinition).mockResolvedValue({
      data: {
        aliases: ['sauna'],
        color: '#f97316',
        display_category: 'wellness',
        display_name: 'Sauna',
        icon: '🧖',
        is_builtin: false,
        name: 'sauna',
        show_on_timeline: true,
      },
      success: true,
    })

    const res = await supertest(buildApp()).post('/activity-types').send({ name: 'sauna' })

    expect(res.status).toBe(201)
    expect(service.addActivityTypeDefinition).toHaveBeenCalledWith('tester', { name: 'sauna' })
    expect(res.body.data).toMatchObject({ display_category: 'wellness', display_name: 'Sauna' })
  })

  test('answers 400 for a name alone outside the catalogue (#1700)', async () => {
    const error =
      'display_name and display_category are required for a type that is not in the built-in catalogue'
    vi.mocked(service.addActivityTypeDefinition).mockResolvedValue({ error, success: false })

    const res = await supertest(buildApp()).post('/activity-types').send({ name: 'driving' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error, success: false })
  })
})

describe('POST /activity-types/:name/item-values/merge', () => {
  beforeEach(() => vi.clearAllMocks())

  const body = { field: 'sets.exercise', source: 'Dumbbell Bicep Curl', target: 'Dumbbell Curl' }

  test('merges and answers with the result', async () => {
    const data = {
      activities_updated: 4,
      alias: {
        alias: 'Dumbbell Bicep Curl',
        created_at: '2026-10-01T00:00:00.000Z',
        field: 'sets.exercise',
        id: '00000000-0000-4000-8000-000000000001',
        value: 'Dumbbell Curl',
      },
    }
    vi.mocked(aliases.mergeItemValues).mockResolvedValue({ data, success: true })

    const res = await supertest(buildApp())
      .post('/activity-types/strength_training/item-values/merge')
      .send(body)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data, success: true })
    expect(aliases.mergeItemValues).toHaveBeenCalledWith('tester', 'strength_training', body)
  })

  test('404s on an unknown type and 400s on another error', async () => {
    const app = buildApp()
    vi.mocked(aliases.mergeItemValues).mockResolvedValueOnce({
      error: 'Activity type "nope" not found',
      success: false,
    })
    expect((await supertest(app).post('/activity-types/nope/item-values/merge').send(body)).status).toBe(404)

    vi.mocked(aliases.mergeItemValues).mockResolvedValueOnce({ error: 'not categorical', success: false })
    const res = await supertest(app).post('/activity-types/strength_training/item-values/merge').send(body)
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'not categorical', success: false })
  })

  test('400s on an invalid body without calling the service', async () => {
    const res = await supertest(buildApp())
      .post('/activity-types/strength_training/item-values/merge')
      .send({ field: 'sets.exercise', source: '  ', target: 'Dumbbell Curl' })
    expect(res.status).toBe(400)
    expect(aliases.mergeItemValues).not.toHaveBeenCalled()
  })
})

describe('GET /activity-types/:name/item-values/aliases', () => {
  beforeEach(() => vi.clearAllMocks())

  test('lists the aliases of the field', async () => {
    const data = [
      {
        alias: 'DB Curl',
        created_at: '2026-10-01T00:00:00.000Z',
        field: 'sets.exercise',
        id: '00000000-0000-4000-8000-000000000001',
        value: 'Dumbbell Curl',
      },
    ]
    vi.mocked(aliases.listAliases).mockResolvedValue({ data, success: true })

    const res = await supertest(buildApp()).get(
      '/activity-types/strength_training/item-values/aliases?field=sets.exercise',
    )

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data, success: true })
    expect(aliases.listAliases).toHaveBeenCalledWith('tester', 'strength_training', 'sets.exercise')
  })

  test('400s on a missing field', async () => {
    const res = await supertest(buildApp()).get('/activity-types/strength_training/item-values/aliases')
    expect(res.status).toBe(400)
    expect(aliases.listAliases).not.toHaveBeenCalled()
  })
})

describe('DELETE /activity-types/:name/item-values/aliases/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  const id = '00000000-0000-4000-8000-000000000001'

  test('deletes the alias', async () => {
    vi.mocked(aliases.deleteAlias).mockResolvedValue({ success: true })
    const res = await supertest(buildApp()).delete(
      `/activity-types/strength_training/item-values/aliases/${id}`,
    )
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(aliases.deleteAlias).toHaveBeenCalledWith('tester', id)
  })

  test('404s on an unknown alias', async () => {
    vi.mocked(aliases.deleteAlias).mockResolvedValue({ error: 'Alias not found', success: false })
    const res = await supertest(buildApp()).delete(
      `/activity-types/strength_training/item-values/aliases/${id}`,
    )
    expect(res.status).toBe(404)
  })
})

describe('item value identity routes', () => {
  const identity = {
    catalog: 'exercises' as const,
    catalog_key: 'lat_pulldown',
    catalog_version: '2026.11.0',
    field: 'sets.exercise',
    other_values: [],
    state: 'user' as const,
    value: 'Pulldown',
  }
  const url = '/activity-types/strength_training/item-values'

  beforeEach(() => vi.clearAllMocks())

  test('GET identity resolves the value', async () => {
    vi.mocked(identities.getItemValueIdentity).mockResolvedValue({ data: identity, success: true })
    const res = await supertest(buildApp())
      .get(`${url}/identity`)
      .query({ field: 'sets.exercise', value: 'Pulldown' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: identity, success: true })
    expect(identities.getItemValueIdentity).toHaveBeenCalledWith(
      'tester',
      'strength_training',
      'sets.exercise',
      'Pulldown',
    )
  })

  test('GET identity 400s for a field without a catalogue and on a missing value', async () => {
    const app = buildApp()
    vi.mocked(identities.getItemValueIdentity).mockResolvedValueOnce({
      error: '"sets.side" is not a catalogue-backed item field of "strength_training"',
      success: false,
    })
    expect(
      (await supertest(app).get(`${url}/identity`).query({ field: 'sets.side', value: 'L' })).status,
    ).toBe(400)
    expect((await supertest(app).get(`${url}/identity`).query({ field: 'sets.exercise' })).status).toBe(400)
    expect(identities.getItemValueIdentity).toHaveBeenCalledTimes(1)
  })

  test('PUT identity maps or dismisses, 400 on an unknown key', async () => {
    const app = buildApp()
    vi.mocked(identities.setItemValueIdentity).mockResolvedValueOnce({ data: identity, success: true })
    const body = { field: 'sets.exercise', key: 'lat_pulldown', value: 'Pulldown' }
    const res = await supertest(app).put(`${url}/identity`).send(body)
    expect(res.status).toBe(200)
    expect(identities.setItemValueIdentity).toHaveBeenCalledWith('tester', 'strength_training', body)

    vi.mocked(identities.setItemValueIdentity).mockResolvedValueOnce({
      error: 'Unknown exercise catalogue key "nope"',
      success: false,
    })
    expect(
      (
        await supertest(app)
          .put(`${url}/identity`)
          .send({ ...body, key: 'nope' })
      ).status,
    ).toBe(400)

    vi.mocked(identities.setItemValueIdentity).mockResolvedValueOnce({
      data: { ...identity, catalog_key: null, state: 'dismissed' },
      success: true,
    })
    expect(
      (
        await supertest(app)
          .put(`${url}/identity`)
          .send({ ...body, key: null })
      ).status,
    ).toBe(200)
  })

  test('DELETE identity clears, 404 when none is stored', async () => {
    const app = buildApp()
    vi.mocked(identities.clearItemValueIdentity).mockResolvedValueOnce({ success: true })
    const query = { field: 'sets.exercise', value: 'Pulldown' }
    expect((await supertest(app).delete(`${url}/identity`).query(query)).body).toEqual({ success: true })
    expect(identities.clearItemValueIdentity).toHaveBeenCalledWith(
      'tester',
      'strength_training',
      'sets.exercise',
      'Pulldown',
    )

    vi.mocked(identities.clearItemValueIdentity).mockResolvedValueOnce({
      error: 'Identity for "Pulldown" not found',
      success: false,
    })
    expect((await supertest(app).delete(`${url}/identity`).query(query)).status).toBe(404)
  })

  test('GET unmapped lists the unmapped values', async () => {
    const data = {
      catalog: 'exercises' as const,
      catalog_version: '2026.11.0',
      field: 'sets.exercise',
      values: [],
    }
    vi.mocked(identities.listUnmappedItemValues).mockResolvedValue({ data, success: true })
    const res = await supertest(buildApp()).get(`${url}/unmapped`).query({ field: 'sets.exercise' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data, success: true })
    expect(identities.listUnmappedItemValues).toHaveBeenCalledWith(
      'tester',
      'strength_training',
      'sets.exercise',
    )
  })
})
