import type { RequestHandler } from 'express'

import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { getChartData } from '../services/chart-data.ts'
import { getChartFirstDay } from '../services/chart-first-day.ts'
import { createChartDataRouter } from './chart-data-router.ts'

vi.mock('../services/chart-data.ts', () => ({ getChartData: vi.fn() }))
vi.mock('../services/chart-first-day.ts', () => ({ getChartFirstDay: vi.fn() }))
vi.mock('../services/settings.ts', () => ({ getUserTimezone: vi.fn(async () => 'Europe/Oslo') }))

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

describe('GET /chart-data breakdown by an item path', () => {
  beforeEach(() => {
    vi.mocked(getChartData).mockReset()
    vi.mocked(getChartData).mockResolvedValue({ buckets: [] })
  })

  const activity =
    '/chart-data?source_type=activity_type&pattern=strength&start=2026-03-01T00:00:00Z&end=2026-04-01T00:00:00Z'

  test('rejects an item path without a measure with 400 without querying', async () => {
    const res = await supertest(app).get(`${activity}&breakdown_fields=sets.exercise`)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('breaking down by an item path needs a measure')
    expect(getChartData).not.toHaveBeenCalled()
  })

  test('accepts an item path with a measure', async () => {
    const res = await supertest(app).get(`${activity}&breakdown_fields=sets.exercise&measure=e1rm`)
    expect(res.status).toBe(200)
    expect(vi.mocked(getChartData).mock.calls[0]?.[1].breakdown_fields).toEqual(['sets.exercise'])
  })

  test('accepts a scalar field without a measure', async () => {
    const res = await supertest(app).get(`${activity}&breakdown_fields=location`)
    expect(res.status).toBe(200)
  })

  test('passes @people through untouched, beside a data field', async () => {
    const res = await supertest(app).get(`${activity}&breakdown_fields=%40people,mood`)
    expect(res.status).toBe(200)
    expect(vi.mocked(getChartData).mock.calls[0]?.[1].breakdown_fields).toEqual(['@people', 'mood'])
  })

  test('passes a muscle-group filter on with a summed measure', async () => {
    const res = await supertest(app).get(
      `${activity}&filter_field=sets.exercise.muscle_group&filter_value=chest&measure=set_count&breakdown_fields=sets.exercise`,
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(getChartData).mock.calls[0]?.[1]).toMatchObject({
      breakdown_fields: ['sets.exercise'],
      filter_field: 'sets.exercise.muscle_group',
      filter_value: 'chest',
    })
  })

  test('rejects a muscle-group filter without a summed measure with 400 without querying', async () => {
    const res = await supertest(app).get(
      `${activity}&filter_field=sets.exercise.muscle_group&filter_value=chest&measure=e1rm`,
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('a muscle-group filter needs measure set_count, volume or total_reps')
    expect(getChartData).not.toHaveBeenCalled()
  })
})

describe('GET /chart-data journal source', () => {
  beforeEach(() => {
    vi.mocked(getChartData).mockReset()
    vi.mocked(getChartData).mockResolvedValue({ buckets: [] })
  })

  const journal = '/chart-data?source_type=journal&start=2026-03-01T00:00:00Z&end=2026-04-01T00:00:00Z'

  test('needs no pattern and passes the journal filters on', async () => {
    const id = '00000000-0000-4000-8000-000000000001'
    const res = await supertest(app).get(
      `${journal}&breakdown_fields=%40tags,%40people&journal_tags=travel&journal_q=sea&journal_entity_types=time,day&journal_related_type=person&journal_related_id=${id}`,
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(getChartData).mock.calls[0]?.[1]).toMatchObject({
      breakdown_fields: ['@tags', '@people'],
      journal_entity_types: 'time,day',
      journal_q: 'sea',
      journal_related_id: id,
      journal_related_type: 'person',
      journal_tags: 'travel',
      source_type: 'journal',
    })
  })

  test.each([
    ['&breakdown_fields=mood', 'a journal breakdown is @tags or @people'],
    ['&measure=e1rm', 'measure and filter_field are for activity_type sources'],
    ['&aggregation=mean', 'a journal chart counts entries (count) or sums their words (sum)'],
    ['&journal_tags=not%20a%20tag!', 'Not a valid tag list (letters, digits and _, comma-separated)'],
    ['&journal_entity_types=note', 'Not a comment root type: note'],
    ['&journal_related_type=person', 'related_type and related_id go together'],
  ])('refuses %s with 400 without querying', async (params, error) => {
    const res = await supertest(app).get(`${journal}${params}`)
    expect(res.status).toBe(400)
    expect(res.body.error).toContain(error)
    expect(getChartData).not.toHaveBeenCalled()
  })

  test('refuses journal filters and @tags on another source', async () => {
    const filtered = await supertest(app).get(`${base}&journal_tags=travel`)
    expect(filtered.status).toBe(400)
    expect(filtered.body.error).toBe('journal_* filters need source_type journal')
    const tags = await supertest(app).get(`${base}&breakdown_fields=%40tags`)
    expect(tags.status).toBe(400)
    expect(tags.body.error).toBe('@tags is a journal breakdown')
    expect(getChartData).not.toHaveBeenCalled()
  })

  test('still needs a pattern for another source', async () => {
    const res = await supertest(app).get(
      '/chart-data?source_type=metric&start=2026-03-01T00:00:00Z&end=2026-04-01T00:00:00Z',
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Either pattern or tag_definition_id is required')
  })
})

describe('GET /chart-data/first-day', () => {
  beforeEach(() => {
    vi.mocked(getChartFirstDay).mockReset()
  })

  test("answers the source's first day, in the user's zone when tz is absent", async () => {
    vi.mocked(getChartFirstDay).mockResolvedValue('1995-04-02')
    const res = await supertest(app).get('/chart-data/first-day?source_type=journal&journal_tags=travel')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: { first_day: '1995-04-02' }, success: true })
    expect(vi.mocked(getChartFirstDay).mock.calls[0]![1]).toMatchObject({
      journal_tags: 'travel',
      source_type: 'journal',
      tz: 'Europe/Oslo',
    })
  })

  test('answers no first day for a source without data, and passes tz on', async () => {
    vi.mocked(getChartFirstDay).mockResolvedValue(undefined)
    const res = await supertest(app).get(
      '/chart-data/first-day?source_type=metric&pattern=weight&tz=Europe/Stockholm',
    )
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: {}, success: true })
    expect(vi.mocked(getChartFirstDay).mock.calls[0]![1].tz).toBe('Europe/Stockholm')
  })

  test('rejects journal filters on another source without querying', async () => {
    const res = await supertest(app).get(
      '/chart-data/first-day?source_type=metric&pattern=weight&journal_q=x',
    )
    expect(res.status).toBe(400)
    expect(getChartFirstDay).not.toHaveBeenCalled()
  })
})
