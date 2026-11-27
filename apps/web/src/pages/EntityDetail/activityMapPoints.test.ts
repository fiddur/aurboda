import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchActivityTrack, fetchRawLocations, pickActivityPoints } from '../../state/api'
import { loadActivityPoints } from './ActivityMap'

vi.mock('../../components/charts/RouteMap', () => ({ RouteMap: () => null }))
vi.mock('../../state/api', () => ({
  fetchActivityTrack: vi.fn(),
  fetchRawLocations: vi.fn(),
  pickActivityPoints: vi.fn(),
}))

const window = {
  activityId: 'a1',
  end: new Date('2026-06-08T11:00:00Z'),
  start: new Date('2026-06-08T10:00:00Z'),
}
const raw = [{ lat: 59, lon: 18, time: new Date('2026-06-08T10:01:00Z') }]

describe('loadActivityPoints', () => {
  beforeEach(() => {
    vi.mocked(fetchActivityTrack).mockReset()
    vi.mocked(fetchRawLocations).mockReset().mockResolvedValue(raw)
    vi.mocked(pickActivityPoints)
      .mockReset()
      .mockImplementation(async (track, loadRaw) => track?.points ?? (await loadRaw()))
  })

  it.each([
    ['absent', undefined],
    ['false', false],
  ])('goes straight to raw GPS when has_track is %s', async (_, hasTrack) => {
    const result = await loadActivityPoints({ ...window, hasTrack })

    expect(fetchActivityTrack).not.toHaveBeenCalled()
    expect(result).toEqual({ points: raw, track_offsets_s: null })
  })

  it('asks for the stored track when has_track is true', async () => {
    const points = [{ lat: 59, lon: 18, time: window.start }]
    vi.mocked(fetchActivityTrack).mockResolvedValue({ full_resolution: true, offsets_s: [0], points })

    const result = await loadActivityPoints({ ...window, hasTrack: true })

    expect(fetchActivityTrack).toHaveBeenCalledWith('a1')
    expect(result).toEqual({ points, track_offsets_s: [0] })
  })
})
