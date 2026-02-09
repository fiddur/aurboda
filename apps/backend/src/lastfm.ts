/**
 * Last.fm API client.
 *
 * Uses the Last.fm API to fetch user scrobble data.
 * API key is stored at the app level, user provides only their username.
 */

import axios from 'axios'

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0/'

export interface Scrobble {
  artist: string
  track: string
  album?: string
  mbid?: string // MusicBrainz ID for track
  artistMbid?: string // MusicBrainz ID for artist
  albumMbid?: string // MusicBrainz ID for album
  timestamp: Date
}

interface LastFmTrack {
  name: string
  artist: { '#text': string; mbid?: string }
  album?: { '#text': string; mbid?: string }
  mbid?: string
  date?: { uts: string }
  '@attr'?: { nowplaying?: string }
}

interface LastFmRecentTracksResponse {
  recenttracks: {
    track: LastFmTrack[]
    '@attr': {
      page: string
      perPage: string
      totalPages: string
      total: string
    }
  }
}

/**
 * Create a Last.fm API client.
 *
 * @param apiKey - Last.fm API key (app-level, from LASTFM_API_KEY env var)
 */
export const lastfmClient = (apiKey: string) => {
  if (!apiKey) throw new Error('Last.fm API key missing')

  return {
    /**
     * Get recent tracks (scrobbles) for a user.
     *
     * @param username - Last.fm username
     * @param from - Optional start date (Unix timestamp or Date)
     * @param to - Optional end date (Unix timestamp or Date)
     * @param limit - Number of tracks per page (max 200, default 200)
     */
    async getRecentTracks(
      username: string,
      from?: Date,
      to?: Date,
      limit: number = 200,
    ): Promise<Scrobble[]> {
      const allScrobbles: Scrobble[] = []
      let page = 1
      let totalPages = 1

      const fromTs = from ? Math.floor(from.getTime() / 1000) : undefined
      const toTs = to ? Math.floor(to.getTime() / 1000) : undefined

      do {
        const params: Record<string, string | number> = {
          api_key: apiKey,
          format: 'json',
          limit,
          method: 'user.getrecenttracks',
          page,
          user: username,
        }

        if (fromTs !== undefined) params.from = fromTs
        if (toTs !== undefined) params.to = toTs

        const response = await axios.get<LastFmRecentTracksResponse>(LASTFM_API_BASE, { params })

        const data = response.data
        if (!data.recenttracks?.track) {
          break
        }

        totalPages = parseInt(data.recenttracks['@attr'].totalPages, 10)

        const tracks =
          Array.isArray(data.recenttracks.track) ? data.recenttracks.track : [data.recenttracks.track]

        for (const track of tracks) {
          // Skip "now playing" tracks (they don't have a timestamp)
          if (track['@attr']?.nowplaying === 'true' || !track.date?.uts) {
            continue
          }

          allScrobbles.push({
            album: track.album?.['#text'] || undefined,
            albumMbid: track.album?.mbid || undefined,
            artist: track.artist['#text'],
            artistMbid: track.artist.mbid || undefined,
            mbid: track.mbid || undefined,
            timestamp: new Date(parseInt(track.date.uts, 10) * 1000),
            track: track.name,
          })
        }

        page++
      } while (page <= totalPages)

      return allScrobbles
    },
  }
}

export type LastFmClient = ReturnType<typeof lastfmClient>
