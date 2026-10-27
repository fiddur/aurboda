import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as MergeModule from '../db/activities/merge.ts'

import { createActivitiesRouter } from './activities-router.ts'

// Mock the DB barrel and the queries barrel the router pulls from. Only the
// functions the GET /activities/:id plain path calls need real behaviour.
vi.mock('../db/index.ts', async () => ({
  getActivityById: vi.fn(),
  getActivityTrack: vi.fn(),
  getDeductionRule: vi.fn().mockResolvedValue(null),
  getOverlappingActivities: vi.fn().mockResolvedValue([]),
  getAllActivityTypeNames: vi.fn().mockResolvedValue(['running']),
  getRouteForActivity: vi.fn().mockResolvedValue(null),
  pickOverrideWinner: (await vi.importActual<typeof MergeModule>('../db/activities/merge.ts'))
    .pickOverrideWinner,
}))

vi.mock('../services/queries/index.ts', () => ({
  computeActivityDetailMetrics: vi.fn().mockResolvedValue({}),
  dedupeCommentsForIds: vi.fn(),
  getActivityFullDetail: vi.fn(),
  getActivityNeighbors: vi.fn(),
  queryActivityItemHistory: vi.fn(),
  getCommentsMap: vi.fn(),
  parseActivityId: vi.fn(),
  parseDataFilter: vi.fn(),
  parseMetricsParam: vi.fn(),
  queryActivities: vi.fn(),
  resolveActivityWindow: vi.fn(),
}))

vi.mock('../services/mutations.ts', () => ({
  addActivity: vi.fn(),
  deleteActivity: vi.fn(),
  mergeActivities: vi.fn(),
  restoreActivity: vi.fn(),
  updateActivity: vi.fn(),
}))

vi.mock('../services/fit-parser.ts', () => ({ parseFitBuffer: vi.fn() }))

vi.mock('../services/activity-features.ts', () => ({ firstActivityFeatures: vi.fn() }))

const db = await import('../db/index.ts')
const queries = await import('../services/queries/index.ts')
const activityFeatures = await import('../services/activity-features.ts')

const ACTIVITY_ID = '9d0124e7-d161-4855-a54f-fa8bdb45c4f2'

type ResyncDetail = Parameters<typeof createActivitiesRouter>[3]

const buildApp = (resyncActivityDetail?: ResyncDetail) => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use(
    createActivitiesRouter(
      auth,
      undefined,
      undefined,
      resyncActivityDetail,
    ) as unknown as express.RequestHandler,
  )
  return app
}

const activityRow = (overrides: Record<string, unknown> = {}) =>
  ({
    activity_type: 'running',
    data: {},
    id: ACTIVITY_ID,
    source: 'garmin',
    start_time: new Date('2026-06-08T10:00:00Z'),
    ...overrides,
  }) as unknown as Awaited<ReturnType<typeof db.getActivityById>>

describe('GET /activities/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queries.computeActivityDetailMetrics).mockResolvedValue(
      {} as Awaited<ReturnType<typeof queries.computeActivityDetailMetrics>>,
    )
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'running',
      data: {},
      id: ACTIVITY_ID,
      source: 'garmin',
      start_time: new Date('2026-06-08T10:00:00Z'),
    } as unknown as Awaited<ReturnType<typeof db.getActivityById>>)
  })

  test('includes the user notes as comments (#794)', async () => {
    vi.mocked(queries.getCommentsMap).mockResolvedValue(
      new Map([[ACTIVITY_ID, [{ content: 'Tempo run — felt strong', id: 'note-1' }]]]) as Awaited<
        ReturnType<typeof queries.getCommentsMap>
      >,
    )

    const res = await supertest(buildApp()).get(`/activities/${ACTIVITY_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.data.comments).toEqual([{ content: 'Tempo run — felt strong', id: 'note-1' }])
    expect(vi.mocked(queries.getCommentsMap)).toHaveBeenCalledWith('tester', 'activity', [ACTIVITY_ID])
  })

  test('includes the route the activity was matched to', async () => {
    vi.mocked(queries.getCommentsMap).mockResolvedValue(
      new Map() as Awaited<ReturnType<typeof queries.getCommentsMap>>,
    )
    vi.mocked(db.getRouteForActivity).mockResolvedValueOnce({
      activity_count: 5,
      id: 'route-1',
      name: 'Söderhallarna · 8.2 km',
    } as Awaited<ReturnType<typeof db.getRouteForActivity>>)

    const res = await supertest(buildApp()).get(`/activities/${ACTIVITY_ID}`)

    expect(res.body.data.route).toEqual({ activity_count: 5, id: 'route-1', name: 'Söderhallarna · 8.2 km' })
    expect(db.getRouteForActivity).toHaveBeenCalledWith('tester', ACTIVITY_ID)
  })

  test('includes the computed features when the activity has them', async () => {
    vi.mocked(queries.getCommentsMap).mockResolvedValue(
      new Map() as Awaited<ReturnType<typeof queries.getCommentsMap>>,
    )
    const features = {
      activity_id: ACTIVITY_ID,
      computed_at: '2026-06-01T00:00:00.000Z',
      low_hr_fraction: 0.9,
    }
    vi.mocked(activityFeatures.firstActivityFeatures).mockResolvedValueOnce(
      features as Awaited<ReturnType<typeof activityFeatures.firstActivityFeatures>>,
    )

    const res = await supertest(buildApp()).get(`/activities/${ACTIVITY_ID}`)

    expect(res.body.data.features).toEqual(features)
    expect(activityFeatures.firstActivityFeatures).toHaveBeenCalledWith('tester', [ACTIVITY_ID])
  })

  test('returns an empty comments array when the activity has no notes', async () => {
    vi.mocked(queries.getCommentsMap).mockResolvedValue(
      new Map() as Awaited<ReturnType<typeof queries.getCommentsMap>>,
    )

    const res = await supertest(buildApp()).get(`/activities/${ACTIVITY_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.data.comments).toEqual([])
  })

  describe('referenced_rules (#1219)', () => {
    const RULES: Record<string, string> = {
      'rule-created': 'Sauna from heat',
      'rule-enriched': 'Tag the gym',
      'rule-retyped': 'Yoga is yin',
    }

    beforeEach(() => {
      vi.mocked(queries.getCommentsMap).mockResolvedValue(
        new Map() as Awaited<ReturnType<typeof queries.getCommentsMap>>,
      )
      vi.mocked(db.getDeductionRule).mockImplementation(
        async (_user, id) =>
          (RULES[id] ? { id, name: RULES[id] } : null) as Awaited<ReturnType<typeof db.getDeductionRule>>,
      )
    })

    test('names the rules behind rule_id, _enriched_by and _retyped_by', async () => {
      vi.mocked(db.getActivityById).mockResolvedValue(
        activityRow({
          data: { _enriched_by: 'rule-enriched', _retyped_by: 'rule-retyped', rule_id: 'rule-created' },
        }),
      )

      const res = await supertest(buildApp()).get(`/activities/${ACTIVITY_ID}`)

      expect(res.status).toBe(200)
      expect(res.body.referenced_rules).toEqual(RULES)
    })

    test('names them in the merged view too', async () => {
      const activity = activityRow({ data: { _retyped_by: 'rule-retyped' } })
      vi.mocked(db.getActivityById).mockResolvedValue(activity)
      vi.mocked(db.getOverlappingActivities).mockResolvedValue([activity!])
      vi.mocked(queries.dedupeCommentsForIds).mockReturnValue([])

      const res = await supertest(buildApp()).get(`/activities/merged:${ACTIVITY_ID}`)

      expect(res.status).toBe(200)
      expect(res.body.referenced_rules).toEqual({ 'rule-retyped': 'Yoga is yin' })
    })

    test('leaves referenced_rules out when no rule is found', async () => {
      vi.mocked(db.getActivityById).mockResolvedValue(activityRow({ data: { _retyped_by: 'gone' } }))

      const res = await supertest(buildApp()).get(`/activities/${ACTIVITY_ID}`)

      expect(res.body).not.toHaveProperty('referenced_rules')
    })
  })
})

describe('GET /activities/merged:id with an aurboda override', () => {
  const GARMIN_ID = '1f5c2e8a-3b4d-4e6f-9a0b-1c2d3e4f5a6b'
  const OVERRIDE_ID = '7a8b9c0d-1e2f-4a3b-8c5d-6e7f8a9b0c1d'

  const row = (overrides: Record<string, unknown>) =>
    activityRow(overrides) as NonNullable<Awaited<ReturnType<typeof db.getActivityById>>>

  const garminRow = row({
    activity_type: 'yoga',
    data: { garmin_field: 1, shared: 'garmin' },
    end_time: new Date('2026-06-08T10:30:00Z'),
    id: GARMIN_ID,
    title: 'Yoga',
  })
  const overrideRow = (overrides: Record<string, unknown> = {}) =>
    row({
      activity_type: 'yoga',
      data: { shared: 'override' },
      end_time: new Date('2026-06-08T10:20:00Z'),
      id: OVERRIDE_ID,
      override_target_ids: [GARMIN_ID],
      source: 'aurboda',
      start_time: new Date('2026-06-08T10:05:00Z'),
      title: 'Hand typed',
      ...overrides,
    })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queries.computeActivityDetailMetrics).mockResolvedValue(
      {} as Awaited<ReturnType<typeof queries.computeActivityDetailMetrics>>,
    )
    vi.mocked(queries.getCommentsMap).mockResolvedValue(
      new Map() as Awaited<ReturnType<typeof queries.getCommentsMap>>,
    )
    vi.mocked(queries.dedupeCommentsForIds).mockReturnValue([])
  })

  test('reports the override’s own title, span and data when the override is requested', async () => {
    const ov = overrideRow()
    vi.mocked(db.getActivityById).mockResolvedValue(ov)
    vi.mocked(db.getOverlappingActivities).mockResolvedValue([garminRow, ov])

    const res = await supertest(buildApp()).get(`/activities/merged:${OVERRIDE_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('Hand typed')
    expect(res.body.data.merged_start_time).toBe('2026-06-08T10:05:00.000Z')
    expect(res.body.data.merged_end_time).toBe('2026-06-08T10:20:00.000Z')
    expect(res.body.data.data).toEqual({ shared: 'override' })
    expect(res.body.data.source_records.map((r: { id: string }) => r.id)).toEqual([GARMIN_ID, OVERRIDE_ID])
    expect(queries.computeActivityDetailMetrics).toHaveBeenLastCalledWith('tester', {
      data: { shared: 'override' },
      end_time: new Date('2026-06-08T10:20:00Z'),
      start_time: new Date('2026-06-08T10:05:00Z'),
    })
  })

  test('reports the override’s title when the synced row it overrides is requested', async () => {
    const ov = overrideRow()
    vi.mocked(db.getActivityById).mockResolvedValue(garminRow)
    vi.mocked(db.getOverlappingActivities).mockResolvedValue([garminRow, ov])

    const res = await supertest(buildApp()).get(`/activities/merged:${GARMIN_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('Hand typed')
    expect(res.body.data.id).toBe(GARMIN_ID)
  })

  test('keeps an override’s empty title — the source title does not fill in', async () => {
    const ov = overrideRow({ title: '' })
    vi.mocked(db.getActivityById).mockResolvedValue(ov)
    vi.mocked(db.getOverlappingActivities).mockResolvedValue([garminRow, ov])

    const res = await supertest(buildApp()).get(`/activities/merged:${OVERRIDE_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('')
  })

  test('still blends a group without an override', async () => {
    const healthConnect = row({
      activity_type: 'yoga',
      end_time: new Date('2026-06-08T10:35:00Z'),
      id: OVERRIDE_ID,
      source: 'health_connect',
      start_time: new Date('2026-06-08T09:55:00Z'),
      title: 'Health Connect yoga',
    })
    vi.mocked(db.getActivityById).mockResolvedValue(garminRow)
    vi.mocked(db.getOverlappingActivities).mockResolvedValue([garminRow, healthConnect])

    const res = await supertest(buildApp()).get(`/activities/merged:${GARMIN_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('Health Connect yoga')
    expect(res.body.data.merged_start_time).toBe('2026-06-08T09:55:00.000Z')
    expect(res.body.data.merged_end_time).toBe('2026-06-08T10:35:00.000Z')
  })
})

describe('GET /activities', () => {
  test('passes a route filter to the query', async () => {
    vi.mocked(queries.queryActivities).mockResolvedValue([])
    const routeId = '6f1c3b2a-4d5e-4f60-8a7b-9c0d1e2f3a4b'

    const res = await supertest(buildApp()).get('/activities').query({
      end: '2026-06-30T00:00:00Z',
      route_id: routeId,
      start: '2026-06-01T00:00:00Z',
      types: 'running',
    })

    expect(res.status).toBe(200)
    expect(vi.mocked(queries.queryActivities).mock.calls.at(-1)?.[7]).toBe(routeId)
  })

  test('passes a run category filter to the query', async () => {
    vi.mocked(queries.queryActivities).mockResolvedValue([])

    const res = await supertest(buildApp()).get('/activities').query({
      category: 'low_hr',
      end: '2026-06-30T00:00:00Z',
      start: '2026-06-01T00:00:00Z',
      types: 'running',
    })

    expect(res.status).toBe(200)
    expect(vi.mocked(queries.queryActivities).mock.calls.at(-1)?.[8]).toBe('low_hr')
  })
})

describe('GET /activities/:id/track', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queries.parseActivityId).mockImplementation((raw: string) => ({
      id: raw.replace(/^merged:/, ''),
      isMerged: raw.startsWith('merged:'),
    }))
  })

  test('returns the track without its internal start time, for a merged id too', async () => {
    vi.mocked(db.getActivityTrack).mockResolvedValue({
      activity_id: ACTIVITY_ID,
      full_resolution: true,
      length_m: 1112,
      point_count: 2,
      points: [
        { alt: 10, lat: 59, lon: 18, t: 0 },
        { alt: 12, lat: 59.01, lon: 18, t: 60 },
      ],
      source: 'garmin',
      start_time: new Date('2026-06-08T10:00:00Z'),
    })

    const res = await supertest(buildApp()).get(`/activities/merged:${ACTIVITY_ID}/track`)

    expect(res.status).toBe(200)
    expect(db.getActivityTrack).toHaveBeenCalledWith('tester', ACTIVITY_ID)
    expect(res.body).toEqual({
      data: {
        activity_id: ACTIVITY_ID,
        full_resolution: true,
        length_m: 1112,
        point_count: 2,
        points: [
          { alt: 10, lat: 59, lon: 18, t: 0 },
          { alt: 12, lat: 59.01, lon: 18, t: 60 },
        ],
        source: 'garmin',
      },
      success: true,
    })
  })

  test('404s when the activity has no track', async () => {
    vi.mocked(db.getActivityTrack).mockResolvedValue(null)

    const res = await supertest(buildApp()).get(`/activities/${ACTIVITY_ID}/track`)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'No track for activity', success: false })
  })
})

describe('GET /activities/:id/full', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queries.parseActivityId).mockReturnValue({ id: ACTIVITY_ID, isMerged: false })
    vi.mocked(db.getActivityById).mockResolvedValue(activityRow())
    vi.mocked(queries.resolveActivityWindow).mockResolvedValue({
      data: {},
      start_time: new Date('2026-06-08T10:00:00Z'),
    } as unknown as Awaited<ReturnType<typeof queries.resolveActivityWindow>>)
    vi.mocked(queries.computeActivityDetailMetrics).mockResolvedValue(
      {} as Awaited<ReturnType<typeof queries.computeActivityDetailMetrics>>,
    )
    vi.mocked(queries.getActivityFullDetail).mockImplementation(
      async (_user, _window, options) =>
        (options.includeGps ? { gps: [{ lat: 59, lon: 18, time: '2026-06-08T10:00:00Z' }] } : {}) as Awaited<
          ReturnType<typeof queries.getActivityFullDetail>
        >,
    )
  })

  test.each([['false'], ['0']])('include_gps=%s leaves the GPS trace out (#1239)', async (flag) => {
    const res = await supertest(buildApp()).get(`/activities/${ACTIVITY_ID}/full?include_gps=${flag}`)

    expect(res.status).toBe(200)
    expect(res.body.data).not.toHaveProperty('gps')
    expect(vi.mocked(queries.getActivityFullDetail).mock.calls[0][2]).toMatchObject({ includeGps: false })
  })

  test('includes the GPS trace by default', async () => {
    const res = await supertest(buildApp()).get(`/activities/${ACTIVITY_ID}/full`)

    expect(res.status).toBe(200)
    expect(res.body.data.gps).toHaveLength(1)
  })

  test('400s on an include_gps value that is not a boolean', async () => {
    const res = await supertest(buildApp()).get(`/activities/${ACTIVITY_ID}/full?include_gps=no`)

    expect(res.status).toBe(400)
    expect(queries.getActivityFullDetail).not.toHaveBeenCalled()
  })
})

describe('POST /activities/:id/resync-detail', () => {
  const GARMIN_SOURCE_ID = '2f1c8a34-1f4e-4a2f-9d7c-6b1e5a0c3d21'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getOverlappingActivities).mockResolvedValue([])
  })

  test('passes the activity’s own span when it carries the Garmin id', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue(
      activityRow({
        data: { garmin_activity_id: 999 },
        end_time: new Date('2026-06-08T11:00:00Z'),
      }),
    )
    const resync = vi.fn().mockResolvedValue(42)

    const res = await supertest(buildApp(resync)).post(`/activities/${ACTIVITY_ID}/resync-detail`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ points: 42, success: true })
    expect(resync).toHaveBeenCalledWith(
      'tester',
      ACTIVITY_ID,
      999,
      { end: new Date('2026-06-08T11:00:00Z'), start: new Date('2026-06-08T10:00:00Z') },
      new Date('2026-06-08T10:00:00Z'),
    )
  })

  test('passes the Garmin source’s span, not the merged activity’s', async () => {
    // The merged wrapper spans wider than the Garmin session it contains; GPS
    // precedence must apply to the Garmin row's span, or it would supersede
    // phone points belonging to the other merged sources.
    vi.mocked(db.getActivityById).mockResolvedValue(
      activityRow({ end_time: new Date('2026-06-08T14:00:00Z'), source: 'aurboda' }),
    )
    vi.mocked(db.getOverlappingActivities).mockResolvedValue([
      activityRow({
        data: { garmin_activity_id: 777 },
        end_time: new Date('2026-06-08T11:30:00Z'),
        id: GARMIN_SOURCE_ID,
        start_time: new Date('2026-06-08T11:00:00Z'),
      }),
    ] as unknown as Awaited<ReturnType<typeof db.getOverlappingActivities>>)
    const resync = vi.fn().mockResolvedValue(7)

    const res = await supertest(buildApp(resync)).post(`/activities/${ACTIVITY_ID}/resync-detail`)

    expect(res.status).toBe(200)
    expect(resync).toHaveBeenCalledWith(
      'tester',
      GARMIN_SOURCE_ID,
      777,
      { end: new Date('2026-06-08T11:30:00Z'), start: new Date('2026-06-08T11:00:00Z') },
      new Date('2026-06-08T11:00:00Z'),
    )
  })

  test('passes a null span when the activity has no end_time', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue(
      activityRow({ data: { garmin_activity_id: 999 }, end_time: undefined }),
    )
    const resync = vi.fn().mockResolvedValue(0)

    await supertest(buildApp(resync)).post(`/activities/${ACTIVITY_ID}/resync-detail`)

    expect(resync).toHaveBeenCalledWith('tester', ACTIVITY_ID, 999, null, new Date('2026-06-08T10:00:00Z'))
  })

  test('400s without touching the resync when no Garmin id can be found', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue(activityRow({ source: 'aurboda' }))
    const resync = vi.fn()

    const res = await supertest(buildApp(resync)).post(`/activities/${ACTIVITY_ID}/resync-detail`)

    expect(res.status).toBe(400)
    expect(resync).not.toHaveBeenCalled()
  })
})

describe('GET /activities/:id/neighbors', () => {
  beforeEach(() => vi.clearAllMocks())

  test('passes the id and same_field through', async () => {
    vi.mocked(queries.getActivityNeighbors).mockResolvedValue({
      activity_type: 'yoga',
      next: { id: `merged:${ACTIVITY_ID}`, start_time: '2026-06-09T07:00:00.000Z' },
    })

    const res = await supertest(buildApp()).get(
      `/activities/merged:${ACTIVITY_ID}/neighbors?same_field=session_name`,
    )

    expect(res.status).toBe(200)
    expect(res.body.data.next.id).toBe(`merged:${ACTIVITY_ID}`)
    expect(queries.getActivityNeighbors).toHaveBeenCalledWith(
      'tester',
      `merged:${ACTIVITY_ID}`,
      'session_name',
    )
  })

  test('404s for an unknown activity, 400s for an invalid field name', async () => {
    vi.mocked(queries.getActivityNeighbors).mockResolvedValue(null)
    expect((await supertest(buildApp()).get(`/activities/${ACTIVITY_ID}/neighbors`)).status).toBe(404)
    expect(
      (await supertest(buildApp()).get(`/activities/${ACTIVITY_ID}/neighbors?same_field=Bad-Name`)).status,
    ).toBe(400)
  })
})

describe('GET /activities/:id/item-history', () => {
  beforeEach(() => vi.clearAllMocks())

  test('passes the id and item path through', async () => {
    vi.mocked(queries.queryActivityItemHistory).mockResolvedValue({
      activity_id: `merged:${ACTIVITY_ID}`,
      field: 'sets.exercise',
      groups: [],
      totals: {},
    })

    const res = await supertest(buildApp()).get(
      `/activities/merged:${ACTIVITY_ID}/item-history?field=sets.exercise`,
    )

    expect(res.status).toBe(200)
    expect(res.body.data.field).toBe('sets.exercise')
    expect(queries.queryActivityItemHistory).toHaveBeenCalledWith(
      'tester',
      `merged:${ACTIVITY_ID}`,
      'sets.exercise',
    )
  })

  test('404s for an unknown activity, 400s for a missing or plain field', async () => {
    vi.mocked(queries.queryActivityItemHistory).mockResolvedValue(null)
    const app = buildApp()
    expect(
      (await supertest(app).get(`/activities/${ACTIVITY_ID}/item-history?field=sets.exercise`)).status,
    ).toBe(404)
    expect((await supertest(app).get(`/activities/${ACTIVITY_ID}/item-history`)).status).toBe(400)
    expect((await supertest(app).get(`/activities/${ACTIVITY_ID}/item-history?field=sets`)).status).toBe(400)
  })
})
