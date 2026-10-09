import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createActivitiesRouter } from './activities-router.ts'

// Mock the DB barrel and the queries barrel the router pulls from. Only the
// functions the GET /activities/:id plain path calls need real behaviour.
vi.mock('../db/index.ts', () => ({
  getActivityById: vi.fn(),
  getActivityTrack: vi.fn(),
  getDeductionRule: vi.fn().mockResolvedValue(null),
  getOverlappingActivities: vi.fn().mockResolvedValue([]),
}))

vi.mock('../services/queries/index.ts', () => ({
  computeActivityDetailMetrics: vi.fn().mockResolvedValue({}),
  dedupeCommentsForIds: vi.fn(),
  getActivityFullDetail: vi.fn(),
  getActivityNeighbors: vi.fn(),
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

const db = await import('../db/index.ts')
const queries = await import('../services/queries/index.ts')

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
    expect(resync).toHaveBeenCalledWith('tester', ACTIVITY_ID, 999, {
      end: new Date('2026-06-08T11:00:00Z'),
      start: new Date('2026-06-08T10:00:00Z'),
    })
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
    expect(resync).toHaveBeenCalledWith('tester', GARMIN_SOURCE_ID, 777, {
      end: new Date('2026-06-08T11:30:00Z'),
      start: new Date('2026-06-08T11:00:00Z'),
    })
  })

  test('passes a null span when the activity has no end_time', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue(
      activityRow({ data: { garmin_activity_id: 999 }, end_time: undefined }),
    )
    const resync = vi.fn().mockResolvedValue(0)

    await supertest(buildApp(resync)).post(`/activities/${ACTIVITY_ID}/resync-detail`)

    expect(resync).toHaveBeenCalledWith('tester', ACTIVITY_ID, 999, null)
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
