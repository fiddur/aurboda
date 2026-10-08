import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./audit-log', () => ({ auditError: vi.fn(), auditInfo: vi.fn(), auditWarn: vi.fn() }))

import type { GarminActivityDetailResponse } from '../integrations/garmin/client.ts'
import type { TrackBackfillDeps } from './track-backfill.ts'

import { auditError } from './audit-log.ts'
import { backfillUserTracks } from './track-backfill.ts'

const start = new Date('2026-05-01T08:00:00Z')
const day = (n: number): Date => new Date(start.getTime() + n * 86_400_000)

const garminDetail = (lat: number, at = start): GarminActivityDetailResponse => ({
  activityDetailMetrics: [
    { metrics: [at.getTime(), lat, 12.62] },
    { metrics: [at.getTime() + 1000, lat + 0.0001, 12.6201] },
  ],
  activityId: 1,
  metricDescriptors: [
    { key: 'directTimestamp', metricsIndex: 0, unit: { key: 'gmt' } },
    { key: 'directLatitude', metricsIndex: 1, unit: { key: 'dd' } },
    { key: 'directLongitude', metricsIndex: 2, unit: { key: 'dd' } },
  ],
})

const pageOf = <T extends { start_time: Date }>(items: T[]) =>
  vi.fn(async (_user: string, { after, limit }: { after?: Date; limit: number }) =>
    items.filter((c) => !after || c.start_time > after).slice(0, limit),
  )

describe('backfillUserTracks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('writes Garmin tracks at full resolution and Strava polylines as shape-only', async () => {
    const deps: TrackBackfillDeps = {
      getGarminCandidates: pageOf([
        { activity_id: 'g1', detail: garminDetail(57.65), end_time: null, start_time: start },
      ]),
      getStravaCandidates: pageOf([
        {
          activity_id: 's1',
          elapsed_seconds: 100,
          polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
          start_time: start,
        },
      ]),
      upsertActivityTrack: vi.fn(async () => undefined),
    }

    const result = await backfillUserTracks('alice', deps)

    expect(result).toEqual({ garmin: 1, skipped: 0, strava: 1 })
    expect(deps.upsertActivityTrack).toHaveBeenCalledWith('alice', {
      activity_id: 'g1',
      ewkt: 'SRID=4326;LINESTRING ZM(12.62 57.65 0 0, 12.6201 57.6501 0 1)',
      full_resolution: true,
      source: 'garmin',
    })
    expect(deps.upsertActivityTrack).toHaveBeenCalledWith('alice', {
      activity_id: 's1',
      ewkt: 'SRID=4326;LINESTRING ZM(-120.2 38.5 0 0, -120.95 40.7 0 50, -126.453 43.252 0 100)',
      full_resolution: false,
      source: 'strava',
    })
  })

  test('pages with the start-time cursor until a short page', async () => {
    const candidates = [0, 1, 2, 3, 4].map((n) => ({
      activity_id: `g${n}`,
      detail: garminDetail(57 + n, day(n)),
      end_time: null,
      start_time: day(n),
    }))
    const getGarminCandidates = pageOf(candidates)
    const deps: TrackBackfillDeps = {
      getGarminCandidates,
      getStravaCandidates: pageOf([]),
      upsertActivityTrack: vi.fn(async () => undefined),
    }

    const result = await backfillUserTracks('alice', deps, 2)

    expect(result).toEqual({ garmin: 5, skipped: 0, strava: 0 })
    expect(getGarminCandidates.mock.calls.map(([, page]) => page.after)).toEqual([undefined, day(1), day(3)])
  })

  test('counts a candidate without a usable track or with a failing write as skipped, and carries on', async () => {
    const upsertActivityTrack = vi.fn(async (_user: string, input: { activity_id: string }) => {
      if (input.activity_id === 'g2') throw new Error('boom')
    })
    const deps: TrackBackfillDeps = {
      getGarminCandidates: pageOf([
        {
          activity_id: 'g1',
          detail: { ...garminDetail(57), activityDetailMetrics: [] },
          end_time: null,
          start_time: day(0),
        },
        { activity_id: 'g2', detail: garminDetail(58, day(1)), end_time: null, start_time: day(1) },
        { activity_id: 'g3', detail: garminDetail(59, day(2)), end_time: null, start_time: day(2) },
      ]),
      getStravaCandidates: pageOf([
        { activity_id: 's1', elapsed_seconds: 100, polyline: 'garbage!', start_time: day(0) },
      ]),
      upsertActivityTrack,
    }

    const result = await backfillUserTracks('alice', deps)

    expect(result).toEqual({ garmin: 1, skipped: 3, strava: 0 })
    expect(upsertActivityTrack).toHaveBeenCalledTimes(2)
    expect(auditError).toHaveBeenCalledTimes(1)
  })
})
