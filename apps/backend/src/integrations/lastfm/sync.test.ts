import { describe, expect, test, vi } from 'vitest'

vi.mock('../../db/index.ts', () => ({
  getSyncState: vi.fn().mockResolvedValue(null),
  insertRawRecord: vi.fn().mockResolvedValue(undefined),
  upsertSyncState: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./client', () => ({
  lastfmClient: vi.fn().mockReturnValue({
    getRecentTracks: vi.fn().mockResolvedValue([]),
  }),
}))

import { getSyncState, insertRawRecord, upsertSyncState } from '../../db/index.ts'
import { lastfmClient } from './client.ts'
import { syncLastFmData } from './sync.ts'

describe('syncLastFmData', () => {
  test('syncs scrobbles and stores raw records', async () => {
    const scrobble = {
      artist: 'Artist',
      track: 'Track',
      album: 'Album',
      timestamp: new Date('2024-01-15T10:00:00Z'),
    }
    vi.mocked(lastfmClient).mockReturnValue({
      getRecentTracks: vi.fn().mockResolvedValue([scrobble]),
    } as never)

    const result = await syncLastFmData('user', 'key', 'username')

    expect(result.status).toBe('success')
    expect(result.scrobbles_processed).toBe(1)
    expect(insertRawRecord).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({ source: 'lastfm', record_type: 'scrobble' }),
    )
    expect(upsertSyncState).toHaveBeenCalledWith('user', expect.objectContaining({ status: 'idle' }))
  })

  test('uses last sync time when available', async () => {
    vi.mocked(getSyncState).mockResolvedValueOnce({
      last_sync_time: new Date('2024-01-10T00:00:00Z'),
      status: 'idle',
    } as never)
    vi.mocked(lastfmClient).mockReturnValue({
      getRecentTracks: vi.fn().mockResolvedValue([]),
    } as never)

    const result = await syncLastFmData('user', 'key', 'username')
    expect(result.status).toBe('success')
  })

  test('uses startDate option when provided with fullResync', async () => {
    vi.mocked(lastfmClient).mockReturnValue({
      getRecentTracks: vi.fn().mockResolvedValue([]),
    } as never)

    const result = await syncLastFmData('user', 'key', 'username', {
      fullResync: true,
      startDate: new Date('2024-01-01'),
    })
    expect(result.status).toBe('success')
  })

  test('handles API errors gracefully', async () => {
    vi.mocked(lastfmClient).mockReturnValue({
      getRecentTracks: vi.fn().mockRejectedValue(new Error('API error')),
    } as never)

    const result = await syncLastFmData('user', 'key', 'username')

    expect(result.status).toBe('error')
    expect(result.error).toBe('API error')
    expect(result.scrobbles_processed).toBe(0)
    expect(upsertSyncState).toHaveBeenCalledWith('user', expect.objectContaining({ status: 'error' }))
  })

  test('handles non-Error exceptions', async () => {
    vi.mocked(lastfmClient).mockReturnValue({
      getRecentTracks: vi.fn().mockRejectedValue('string error'),
    } as never)

    const result = await syncLastFmData('user', 'key', 'username')

    expect(result.status).toBe('error')
    expect(result.error).toBe('Unknown error')
  })

  test('includes HTTP status code in error message when available', async () => {
    const apiError = Object.assign(new Error('Bad request'), {
      response: { status: 400, data: {} },
    })
    vi.mocked(lastfmClient).mockReturnValue({
      getRecentTracks: vi.fn().mockRejectedValue(apiError),
    } as never)

    const result = await syncLastFmData('user', 'key', 'username')

    expect(result.status).toBe('error')
    expect(upsertSyncState).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({ error_message: 'Bad request (HTTP 400)' }),
    )
  })
})
