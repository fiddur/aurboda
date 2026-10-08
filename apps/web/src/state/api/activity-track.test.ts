import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchActivityTrack } from './activities'

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof axios }>()
  return { default: { ...actual.default, get: vi.fn(), isAxiosError: actual.default.isAxiosError } }
})
vi.mock('../../config', () => ({ API_URL: 'http://api.test' }))
vi.mock('../auth', () => ({ auth: { value: { token: 't' } } }))

const start = new Date('2026-06-08T10:00:00Z')

describe('fetchActivityTrack', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset()
  })

  it('times each point from the activity start', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          activity_id: 'a1',
          full_resolution: true,
          length_m: 10,
          point_count: 2,
          points: [
            { alt: 0, lat: 59, lon: 18, t: 0 },
            { alt: 0, lat: 59.01, lon: 18, t: 1.5 },
          ],
          source: 'garmin',
        },
        success: true,
      },
    })

    const points = await fetchActivityTrack('merged:a1', start)

    expect(vi.mocked(axios.get).mock.calls[0]?.[0]).toBe('http://api.test/activities/merged%3Aa1/track')
    expect(points).toEqual([
      { lat: 59, lon: 18, time: new Date('2026-06-08T10:00:00.000Z') },
      { lat: 59.01, lon: 18, time: new Date('2026-06-08T10:00:01.500Z') },
    ])
  })

  it('is null when the activity has no track', async () => {
    vi.mocked(axios.get).mockRejectedValue(
      new axios.AxiosError('Not found', '404', undefined, undefined, {
        data: {},
        headers: {},
        status: 404,
        statusText: 'Not Found',
      } as never),
    )

    expect(await fetchActivityTrack('a1', start)).toBeNull()
  })
})
