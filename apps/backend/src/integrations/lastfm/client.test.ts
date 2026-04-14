/**
 * Last.fm API client tests.
 */

import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { lastfmClient } from './client.ts'

vi.mock('axios')

describe('lastfmClient', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('constructor', () => {
    it('throws error when API key is missing', () => {
      expect(() => lastfmClient('')).toThrow('Last.fm API key missing')
    })

    it('creates client when API key is provided', () => {
      expect(() => lastfmClient('test-api-key')).not.toThrow()
    })
  })

  describe('getRecentTracks', () => {
    it('fetches recent tracks successfully', async () => {
      const mockResponse = {
        data: {
          recenttracks: {
            '@attr': {
              page: '1',
              perPage: '200',
              total: '2',
              totalPages: '1',
            },
            track: [
              {
                album: { '#text': 'Test Album', mbid: 'album-mbid' },
                artist: { '#text': 'Test Artist', mbid: 'artist-mbid' },
                date: { uts: '1704067200' }, // 2024-01-01 00:00:00 UTC
                mbid: 'track-mbid',
                name: 'Test Track',
              },
              {
                album: { '#text': 'Another Album' },
                artist: { '#text': 'Another Artist' },
                date: { uts: '1704070800' }, // 2024-01-01 01:00:00 UTC
                name: 'Another Track',
              },
            ],
          },
        },
      }

      vi.mocked(axios.get).mockResolvedValue(mockResponse)

      const client = lastfmClient('test-api-key')
      const scrobbles = await client.getRecentTracks('testuser')

      expect(scrobbles).toHaveLength(2)
      expect(scrobbles[0]).toEqual({
        album: 'Test Album',
        albumMbid: 'album-mbid',
        artist: 'Test Artist',
        artistMbid: 'artist-mbid',
        mbid: 'track-mbid',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        track: 'Test Track',
      })
      expect(scrobbles[1]).toEqual({
        album: 'Another Album',
        albumMbid: undefined,
        artist: 'Another Artist',
        artistMbid: undefined,
        mbid: undefined,
        timestamp: new Date('2024-01-01T01:00:00.000Z'),
        track: 'Another Track',
      })

      expect(axios.get).toHaveBeenCalledWith('https://ws.audioscrobbler.com/2.0/', {
        params: expect.objectContaining({
          api_key: 'test-api-key',
          format: 'json',
          limit: 200,
          method: 'user.getrecenttracks',
          page: 1,
          user: 'testuser',
        }),
      })
    })

    it('skips now playing tracks', async () => {
      const mockResponse = {
        data: {
          recenttracks: {
            '@attr': { page: '1', perPage: '200', total: '2', totalPages: '1' },
            track: [
              {
                '@attr': { nowplaying: 'true' },
                artist: { '#text': 'Now Playing Artist' },
                name: 'Now Playing Track',
              },
              {
                artist: { '#text': 'Regular Artist' },
                date: { uts: '1704067200' },
                name: 'Regular Track',
              },
            ],
          },
        },
      }

      vi.mocked(axios.get).mockResolvedValue(mockResponse)

      const client = lastfmClient('test-api-key')
      const scrobbles = await client.getRecentTracks('testuser')

      expect(scrobbles).toHaveLength(1)
      expect(scrobbles[0].track).toBe('Regular Track')
    })

    it('handles date range filters', async () => {
      const mockResponse = {
        data: {
          recenttracks: {
            '@attr': { page: '1', perPage: '200', total: '0', totalPages: '1' },
            track: [],
          },
        },
      }

      vi.mocked(axios.get).mockResolvedValue(mockResponse)

      const client = lastfmClient('test-api-key')
      const from = new Date('2024-01-01T00:00:00Z')
      const to = new Date('2024-01-02T00:00:00Z')

      await client.getRecentTracks('testuser', from, to)

      expect(axios.get).toHaveBeenCalledWith(expect.any(String), {
        params: expect.objectContaining({
          from: 1704067200,
          to: 1704153600,
        }),
      })
    })

    it('handles pagination', async () => {
      const page1Response = {
        data: {
          recenttracks: {
            '@attr': { page: '1', perPage: '2', total: '3', totalPages: '2' },
            track: [
              {
                artist: { '#text': 'Artist 1' },
                date: { uts: '1704067200' },
                name: 'Track 1',
              },
              {
                artist: { '#text': 'Artist 2' },
                date: { uts: '1704070800' },
                name: 'Track 2',
              },
            ],
          },
        },
      }

      const page2Response = {
        data: {
          recenttracks: {
            '@attr': { page: '2', perPage: '2', total: '3', totalPages: '2' },
            track: [
              {
                artist: { '#text': 'Artist 3' },
                date: { uts: '1704074400' },
                name: 'Track 3',
              },
            ],
          },
        },
      }

      vi.mocked(axios.get).mockResolvedValueOnce(page1Response).mockResolvedValueOnce(page2Response)

      const client = lastfmClient('test-api-key')
      const scrobbles = await client.getRecentTracks('testuser', undefined, undefined, 2)

      expect(scrobbles).toHaveLength(3)
      expect(axios.get).toHaveBeenCalledTimes(2)
    })

    it('handles empty response', async () => {
      const mockResponse = {
        data: {
          recenttracks: {
            '@attr': { page: '1', perPage: '200', total: '0', totalPages: '0' },
            track: [],
          },
        },
      }

      vi.mocked(axios.get).mockResolvedValue(mockResponse)

      const client = lastfmClient('test-api-key')
      const scrobbles = await client.getRecentTracks('testuser')

      expect(scrobbles).toHaveLength(0)
    })

    it('handles single track response (not array)', async () => {
      const mockResponse = {
        data: {
          recenttracks: {
            '@attr': { page: '1', perPage: '200', total: '1', totalPages: '1' },
            track: {
              artist: { '#text': 'Single Artist' },
              date: { uts: '1704067200' },
              name: 'Single Track',
            },
          },
        },
      }

      vi.mocked(axios.get).mockResolvedValue(mockResponse)

      const client = lastfmClient('test-api-key')
      const scrobbles = await client.getRecentTracks('testuser')

      expect(scrobbles).toHaveLength(1)
      expect(scrobbles[0].track).toBe('Single Track')
    })
  })
})
