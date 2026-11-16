import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { createChallenge, updateChallengeParticipationSnapshot } from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { joinChallenge } from './challenge-federation.ts'
import { listParticipationsFresh } from './challenge-participation-sync.ts'
import { updateHostedChallenge } from './challenge-update.ts'
import { buildShareUrl } from './share-urls.ts'

const CONTAINER_TIMEOUT = 120_000
const WEB_HOST = 'https://aurboda.example'

describe('a participation follows its host on this instance', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const hostAndJoin = async () => {
    const user = getTestUser()
    const challenge = await createChallenge(user, {
      announce_winner: false,
      end_ts: new Date('2026-12-01T00:00:00Z'),
      is_public: true,
      name: 'November steps',
      spec: {
        activity_type_id: null,
        aggregation: 'sum',
        bucket_size: '1d',
        filter_field: null,
        filter_value: null,
        measure: null,
        pattern: 'steps',
        source_type: 'metric',
        unit: 'steps',
      },
      start_ts: new Date('2026-11-01T00:00:00Z'),
      timezone: 'UTC',
    })
    const participation = await joinChallenge({
      apiBaseUrl: `${WEB_HOST}/api`,
      challengeUrl: `${buildShareUrl(WEB_HOST, user, challenge.slug)}?embed=1`,
      user,
      webHost: WEB_HOST,
    })
    return { challenge, participation, user }
  }

  test('a join with a non-canonical link stores the canonical url', async () => {
    const { challenge, participation, user } = await hostAndJoin()
    expect(participation.challenge_url).toBe(buildShareUrl(WEB_HOST, user, challenge.slug))
  })

  test('a rename and a moved end reach the participant on update', async () => {
    const { challenge, participation, user } = await hostAndJoin()
    const result = await updateHostedChallenge(
      user,
      challenge.id,
      { end_ts: new Date('2026-12-15T00:00:00Z'), name: 'Renamed' },
      { webHost: WEB_HOST },
    )
    expect(result.status).toBe('updated')

    const [listed] = await listParticipationsFresh(user, { webHost: WEB_HOST })
    expect(listed).toMatchObject({
      data_token: participation.data_token,
      end_ts: new Date('2026-12-15T00:00:00Z'),
      id: participation.id,
      name: 'Renamed',
    })
  })

  test('a participation that drifted before is repaired when listed', async () => {
    const { participation, user } = await hostAndJoin()
    await updateChallengeParticipationSnapshot(user, participation.id, {
      end_ts: new Date('2026-11-20T00:00:00Z'),
      name: 'Stale name',
    })

    const [listed] = await listParticipationsFresh(user, { webHost: WEB_HOST })
    expect(listed).toMatchObject({ end_ts: new Date('2026-12-01T00:00:00Z'), name: 'November steps' })
    const [again] = await listParticipationsFresh(user, { webHost: WEB_HOST })
    expect(again).toEqual(listed)
  })
})
