import { Encoder, Profile } from '@garmin/fitsdk'
import { describe, expect, test, vi } from 'vitest'

import type { Activity } from '../../db/types.ts'

import {
  downloadGarminFile,
  isGarminFileUrl,
  type PushedActivityFileDeps,
  syncPushedActivityFile,
} from './push-activity-file.ts'

const GARMIN_ID = 4242
const ACCESS_TOKEN = 'fake-access-token-xyz'
const CALLBACK_TOKEN = 'fake-callback-token-abc'
const CALLBACK_URL = `https://apis.garmin.com/wellness-api/rest/activityFile?id=77&token=${CALLBACK_TOKEN}`
const START = new Date('2026-05-01T08:00:00Z')
const END = new Date('2026-05-01T08:30:00Z')

const encodeFit = (): Uint8Array => {
  const encoder = new Encoder()
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    manufacturer: 'development',
    product: 1,
    timeCreated: START,
    type: 'activity',
  } as never)
  encoder.onMesg(Profile.MesgNum.RECORD, {
    heartRate: 120,
    timestamp: new Date(START.getTime() + 1000),
  } as never)
  encoder.onMesg(Profile.MesgNum.SESSION, {
    sport: 'running',
    startTime: START,
    timestamp: END,
    totalElapsedTime: 1800,
  } as never)
  return encoder.close()
}

const activityRow = (overrides: Partial<Activity> = {}): Activity => ({
  activity_type: 'running',
  data: { garmin_activity_id: GARMIN_ID },
  end_time: END,
  id: 'activity-1',
  source: 'garmin',
  start_time: START,
  ...overrides,
})

const makeDeps = (
  options: {
    activity?: Activity | null
    notice?: Record<string, unknown> | null
    download?: { status: number; bytes: Uint8Array | null }
  } = {},
) => {
  const deps = {
    auditError: vi.fn(async () => {}),
    auditInfo: vi.fn(async () => {}),
    auditWarn: vi.fn(async () => {}),
    download: vi.fn(
      async (_url: string, _token: string) => options.download ?? { bytes: encodeFit(), status: 200 },
    ),
    findActivityByGarminActivityId: vi.fn(async () =>
      options.activity === undefined ? activityRow() : options.activity,
    ),
    getAccessToken: vi.fn(async () => ACCESS_TOKEN),
    getFileNotice: vi.fn(async () =>
      options.notice === undefined
        ? { activityId: GARMIN_ID, callbackURL: CALLBACK_URL, fileType: 'FIT' }
        : options.notice,
    ),
    markActivityDetailSynced: vi.fn(async () => {}),
    onDetailSynced: vi.fn(),
    onTrackWritten: vi.fn(),
    processActivityFit: vi.fn(async () => 3),
  }
  return deps satisfies PushedActivityFileDeps
}

type Deps = ReturnType<typeof makeDeps>

const everythingSaid = (deps: Deps) =>
  JSON.stringify([deps.auditInfo.mock.calls, deps.auditWarn.mock.calls, deps.auditError.mock.calls])

const expectNothingSecret = (deps: Deps) => {
  const said = everythingSaid(deps)
  expect(said).not.toContain(CALLBACK_TOKEN)
  expect(said).not.toContain('apis.garmin.com')
  expect(said).not.toContain(ACCESS_TOKEN)
}

describe('isGarminFileUrl', () => {
  test('accepts https on apis.garmin.com only', () => {
    expect(isGarminFileUrl(CALLBACK_URL)).toBe(true)
    expect(isGarminFileUrl('https://APIS.garmin.com/x')).toBe(true)
  })

  test.each([
    'http://apis.garmin.com/wellness-api/rest/activityFile?id=1',
    'https://example.test/activityFile?id=1',
    'https://evilapis.garmin.com/x',
    'https://apis.garmin.com.example.test/x',
    'https://example.test/apis.garmin.com',
    'https://user:pass@apis.garmin.com/x',
    'https://apis.garmin.com@example.test/x',
    'https://apis.garmin.com:8443/x',
    'not a url',
    '',
  ])('refuses %s', (url) => {
    expect(isGarminFileUrl(url)).toBe(false)
  })

  test.each([undefined, null, 42, {}, ['https://apis.garmin.com/x']])('refuses a non-string %j', (value) => {
    expect(isGarminFileUrl(value)).toBe(false)
  })
})

describe('syncPushedActivityFile', () => {
  test('without the activity the notice waits', async () => {
    const deps = makeDeps({ activity: null })
    await syncPushedActivityFile(deps, 'alice', GARMIN_ID)
    expect(deps.getFileNotice).not.toHaveBeenCalled()
    expect(deps.download).not.toHaveBeenCalled()
  })

  test('an activity row without an id is not handled', async () => {
    const deps = makeDeps({ activity: activityRow({ id: undefined }) })
    await syncPushedActivityFile(deps, 'alice', GARMIN_ID)
    expect(deps.download).not.toHaveBeenCalled()
  })

  test('an activity whose detail is already synced is left alone', async () => {
    const deps = makeDeps({
      activity: activityRow({ data: { detail_synced: true, garmin_activity_id: GARMIN_ID } }),
    })
    await syncPushedActivityFile(deps, 'alice', GARMIN_ID)
    expect(deps.getFileNotice).not.toHaveBeenCalled()
    expect(deps.download).not.toHaveBeenCalled()
  })

  test('without the notice the activity waits', async () => {
    const deps = makeDeps({ notice: null })
    await syncPushedActivityFile(deps, 'alice', GARMIN_ID)
    expect(deps.getAccessToken).not.toHaveBeenCalled()
    expect(deps.download).not.toHaveBeenCalled()
    expect(deps.markActivityDetailSynced).not.toHaveBeenCalled()
  })

  test.each([
    'http://apis.garmin.com/x?token=fake-callback-token-abc',
    'https://example.test/x?token=fake-callback-token-abc',
    undefined,
  ])('refuses the address %s and audits it without the URL', async (callbackURL) => {
    const deps = makeDeps({ notice: { callbackURL } })
    await syncPushedActivityFile(deps, 'alice', GARMIN_ID)
    expect(deps.getAccessToken).not.toHaveBeenCalled()
    expect(deps.download).not.toHaveBeenCalled()
    expect(deps.auditWarn).toHaveBeenCalledWith(
      'alice',
      'sync',
      `Garmin: activity file address refused for activity ${GARMIN_ID}`,
    )
    expect(everythingSaid(deps)).not.toContain('example.test')
    expectNothingSecret(deps)
  })

  test('fetches with the bearer token, writes the detail and marks it', async () => {
    const deps = makeDeps()
    await syncPushedActivityFile(deps, 'alice', GARMIN_ID)
    expect(deps.download).toHaveBeenCalledWith(CALLBACK_URL, ACCESS_TOKEN)
    expect(deps.processActivityFit).toHaveBeenCalledWith(
      'alice',
      { fit: expect.objectContaining({ records: [expect.any(Object)] }), garminActivityId: GARMIN_ID },
      {
        activityId: 'activity-1',
        activitySpan: { end: END, start: START },
        activityStart: START,
        onTrackWritten: deps.onTrackWritten,
      },
    )
    expect(deps.markActivityDetailSynced).toHaveBeenCalledWith('alice', 'activity-1')
    expect(deps.onDetailSynced).toHaveBeenCalledWith('alice', 'activity-1')
    expect(deps.auditInfo).toHaveBeenCalledWith(
      'alice',
      'sync',
      `📊 Synced 3 detail metrics for Garmin activity ${GARMIN_ID} from its pushed FIT file`,
    )
    expectNothingSecret(deps)
  })

  test('an activity without an end has no span', async () => {
    const deps = makeDeps({ activity: activityRow({ end_time: undefined }) })
    await syncPushedActivityFile(deps, 'alice', GARMIN_ID)
    expect(deps.processActivityFit).toHaveBeenCalledWith(
      'alice',
      expect.any(Object),
      expect.objectContaining({ activitySpan: null, activityStart: START }),
    )
  })

  test.each([404, 410])('a %i is noted and leaves the activity unmarked', async (status) => {
    const deps = makeDeps({ download: { bytes: null, status } })
    await syncPushedActivityFile(deps, 'alice', GARMIN_ID)
    expect(deps.auditInfo).toHaveBeenCalledWith(
      'alice',
      'sync',
      `Garmin no longer serves the file for activity ${GARMIN_ID}`,
    )
    expect(deps.markActivityDetailSynced).not.toHaveBeenCalled()
    expect(deps.processActivityFit).not.toHaveBeenCalled()
  })

  test('another refusal is warned with its status and leaves the activity unmarked', async () => {
    const deps = makeDeps({ download: { bytes: null, status: 401 } })
    await syncPushedActivityFile(deps, 'alice', GARMIN_ID)
    expect(deps.auditWarn).toHaveBeenCalledWith('alice', 'sync', expect.any(String), { status: 401 })
    expect(deps.markActivityDetailSynced).not.toHaveBeenCalled()
  })

  test('a file over the cap is warned and leaves the activity unmarked', async () => {
    const deps = makeDeps({ download: { bytes: null, status: 200 } })
    await syncPushedActivityFile(deps, 'alice', GARMIN_ID)
    expect(deps.auditWarn).toHaveBeenCalledTimes(1)
    expect(deps.markActivityDetailSynced).not.toHaveBeenCalled()
    expect(deps.processActivityFit).not.toHaveBeenCalled()
  })

  test('an unreadable file is warned and marked, as asking again gives the same bytes', async () => {
    const deps = makeDeps({ download: { bytes: new TextEncoder().encode('<gpx/>'), status: 200 } })
    await syncPushedActivityFile(deps, 'alice', GARMIN_ID)
    expect(deps.auditWarn).toHaveBeenCalledWith(
      'alice',
      'sync',
      `Garmin: could not read the activity file for activity ${GARMIN_ID}`,
    )
    expect(deps.markActivityDetailSynced).toHaveBeenCalledWith('alice', 'activity-1')
    expect(deps.processActivityFit).not.toHaveBeenCalled()
    expect(deps.onDetailSynced).not.toHaveBeenCalled()
  })

  test('a failure is audited with the URL, its query and the token redacted', async () => {
    const deps = makeDeps()
    deps.download.mockRejectedValueOnce(
      new Error(`fetch ${CALLBACK_URL} failed; token=${CALLBACK_TOKEN}; Bearer ${ACCESS_TOKEN}`),
    )
    await expect(syncPushedActivityFile(deps, 'alice', GARMIN_ID)).resolves.toBeUndefined()
    expect(deps.auditError).toHaveBeenCalledWith(
      'alice',
      'sync',
      `Failed to sync the pushed file for Garmin activity ${GARMIN_ID}`,
      { error: expect.any(String) },
    )
    expectNothingSecret(deps)
    expect(deps.markActivityDetailSynced).not.toHaveBeenCalled()
  })

  test('a token failure is audited', async () => {
    const deps = makeDeps()
    deps.getAccessToken.mockRejectedValueOnce(
      new Error('Garmin is not connected through Connect with Garmin'),
    )
    await syncPushedActivityFile(deps, 'alice', GARMIN_ID)
    expect(deps.download).not.toHaveBeenCalled()
    expect(deps.auditError).toHaveBeenCalledTimes(1)
  })

  test('a processing failure leaves the activity unmarked', async () => {
    const deps = makeDeps()
    deps.processActivityFit.mockRejectedValueOnce(new Error('db down'))
    await syncPushedActivityFile(deps, 'alice', GARMIN_ID)
    expect(deps.auditError).toHaveBeenCalledWith('alice', 'sync', expect.any(String), { error: 'db down' })
    expect(deps.markActivityDetailSynced).not.toHaveBeenCalled()
  })
})

describe('downloadGarminFile', () => {
  const fakeFetch = (response: Response) =>
    vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response)

  test('sends the bearer token and reads the body', async () => {
    const fetch = fakeFetch(new Response(new Uint8Array([1, 2, 3])))
    const result = await downloadGarminFile(CALLBACK_URL, ACCESS_TOKEN, { fetch })
    expect(result).toEqual({ bytes: new Uint8Array([1, 2, 3]), status: 200 })
    expect(fetch).toHaveBeenCalledWith(
      CALLBACK_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(fetch.mock.calls[0]![1]!.headers).toEqual({ Authorization: `Bearer ${ACCESS_TOKEN}` })
  })

  test('a non-2xx answer is its status without a body', async () => {
    const fetch = fakeFetch(new Response('gone', { status: 410 }))
    expect(await downloadGarminFile(CALLBACK_URL, ACCESS_TOKEN, { fetch })).toEqual({
      bytes: null,
      status: 410,
    })
  })

  test('a body over the cap is no bytes', async () => {
    const fetch = fakeFetch(new Response(new Uint8Array(10)))
    expect(await downloadGarminFile(CALLBACK_URL, ACCESS_TOKEN, { fetch, maxBytes: 5 })).toEqual({
      bytes: null,
      status: 200,
    })
  })

  test('a declared length over the cap is no bytes', async () => {
    const fetch = fakeFetch(new Response(new Uint8Array(10), { headers: { 'content-length': '10' } }))
    expect(await downloadGarminFile(CALLBACK_URL, ACCESS_TOKEN, { fetch, maxBytes: 5 })).toEqual({
      bytes: null,
      status: 200,
    })
  })
})
