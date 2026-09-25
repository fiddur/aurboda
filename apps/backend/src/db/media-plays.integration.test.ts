import type { DeductionRule, MediaPlayInput } from '@aurboda/api-spec'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { createDefaultEngineDeps } from '../services/deduction-deps.ts'
import { evaluateRule } from '../services/deduction-engine.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getActivityById, insertActivity } from './index.ts'
import { getMediaPlays, storeMediaPlays } from './media-plays.ts'
import { insertRawRecord, queryRawRecords } from './raw-records.ts'

const CONTAINER_TIMEOUT = 120_000

const play = (overrides: Partial<MediaPlayInput> = {}): MediaPlayInput => ({
  album: '',
  artist: '',
  device: 'laptop',
  ended_at: '2026-01-10T10:32:00.000Z',
  id: 'play-1',
  max_position_secs: 1790,
  played_secs: 1710,
  player: 'firefox',
  seek_count: 0,
  started_at: '2026-01-10T10:02:00.000Z',
  title: 'Yin Yoga for Healthy Hips with Meagan — True Naked Yoga',
  track_secs: 1800,
  url: 'https://www.truenakedyoga.com/videos/yin-hips',
  ...overrides,
})

const window = { end: new Date('2026-01-11T00:00:00Z'), start: new Date('2026-01-10T00:00:00Z') }

describe('media plays (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('storing the same plays twice keeps one row per id', async () => {
    const user = getTestUser()
    const batch = [play(), play({ id: 'play-2', started_at: '2026-01-10T11:00:00.000Z' }), play()]

    expect(await storeMediaPlays(user, batch, 'laptop')).toEqual({ plays_received: 3, plays_stored: 2 })
    await storeMediaPlays(user, [play({ played_secs: 1750 })], 'laptop')

    const { rows, total } = await queryRawRecords(user, { record_type: 'media_play', source: 'mpris' })
    expect(total).toBe(2)
    const first = rows.find((r) => r.external_id === 'play-1')!
    expect(first.recorded_at.toISOString()).toBe('2026-01-10T10:02:00.000Z')
    expect(first.data).toMatchObject({ device_name: 'laptop', played_secs: 1750, track_secs: 1800 })
  })

  test('getMediaPlays returns plays in the window and drops duplicate scrobbles', async () => {
    const user = getTestUser()
    await storeMediaPlays(
      user,
      [
        play({
          artist: 'Portishead',
          ended_at: '2026-01-10T12:04:00.000Z',
          id: 'song',
          started_at: '2026-01-10T12:00:00.000Z',
          title: 'Roads',
          track_secs: null,
          url: '',
        }),
        play(),
        play({ ended_at: '2026-01-09T10:10:00.000Z', id: 'old', started_at: '2026-01-09T10:00:00.000Z' }),
      ],
      undefined,
    )
    await insertRawRecord(user, {
      data: { album: 'Dummy', artist: 'Portishead', track: 'Roads' },
      external_id: 'dup',
      record_type: 'scrobble',
      recorded_at: new Date('2026-01-10T12:02:00Z'),
      source: 'lastfm',
    })
    await insertRawRecord(user, {
      data: { album: 'Mezzanine', artist: 'Massive Attack', track: 'Teardrop' },
      external_id: 'keep',
      record_type: 'scrobble',
      recorded_at: new Date('2026-01-10T13:00:00Z'),
      source: 'lastfm',
    })

    const plays = await getMediaPlays(user, window)

    expect(plays.map((p) => p.id)).toEqual(['play-1', 'song', 'keep'])
    expect(plays[0]).toMatchObject({ kind: null, played_ratio: 1710 / 1800, source: 'mpris' })
    expect(plays[1]).toMatchObject({ played_ratio: null, track_secs: null })
    expect(plays[2]).toMatchObject({ ended_at: null, kind: 'music', source: 'lastfm', title: 'Teardrop' })
  })

  test('an enrich rule writes the play title onto the activity it overlaps', async () => {
    const user = getTestUser()
    const activityId = await insertActivity(user, {
      activity_type: 'yoga',
      data: {},
      end_time: new Date('2026-01-10T10:35:00Z'),
      id: '5c1c0b56-8d2e-4a44-9d51-3c7a1f0e2b10',
      source: 'garmin',
      start_time: new Date('2026-01-10T10:00:00Z'),
      title: 'Yoga',
    })
    await storeMediaPlays(user, [play()], 'laptop')

    const rule: DeductionRule = {
      conditions: [
        { activity_type: 'yoga', kind: 'activity' },
        {
          kind: 'media',
          match_mode: 'contains',
          min_played_ratio: 0.8,
          min_played_secs: 600,
          url_host: ['truenakedyoga.com'],
        },
      ],
      enabled: true,
      id: '0f8b2a39-1d0e-4c64-9d8c-6b3b3c2f7a01',
      mode: 'enrich',
      name: 'Yoga session name',
      output_activity_type: 'yoga',
      output_media_field: { field: 'session_name', strip_pattern: '\\s*—\\s*True Naked Yoga$' },
      priority: 0,
    }
    const deps = createDefaultEngineDeps()

    expect((await evaluateRule(user, rule, window, deps)).affected_ids).toEqual([activityId])
    expect((await getActivityById(user, activityId))?.data).toMatchObject({
      _enriched_by: rule.id,
      session_name: 'Yin Yoga for Healthy Hips with Meagan',
    })
    expect((await evaluateRule(user, rule, window, deps)).affected_ids).toEqual([])
  })
})
