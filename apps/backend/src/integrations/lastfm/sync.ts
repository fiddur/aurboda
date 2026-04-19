/**
 * Last.fm data sync module.
 *
 * Fetches scrobbles from Last.fm and stores them in two places:
 *   - raw_records (kept for sync dedup and as the data source for the
 *     `scrobble` condition in deduction rules)
 *   - activities with activity_type='music_scrobble', so scrobbles can be
 *     queried, charted, and broken down by artist via the unified activity
 *     pipeline. These are excluded from the main activity-column timeline
 *     rendering (see EXCLUDED_ACTIVITY_SOURCES on the frontend) and rendered
 *     separately on the music staff track.
 */

import { subDays } from 'date-fns'

import type { Activity } from '../../db/types.ts'

import { getSyncState, insertActivities, insertRawRecord, upsertSyncState } from '../../db/index.ts'
import { lastfmClient } from './client.ts'

/** Default start date for historical sync (30 days back) */
const DEFAULT_SYNC_HISTORY_DAYS = 30

/** Result of a sync operation */
export interface LastFmSyncResult {
  scrobbles_processed: number
  status: 'success' | 'skipped' | 'error'
  error?: string
}

/**
 * Sync Last.fm scrobbles for a user.
 */
export const syncLastFmData = async (
  user: string,
  apiKey: string,
  username: string,
  options: { fullResync?: boolean; startDate?: Date } = {},
): Promise<LastFmSyncResult> => {
  const dataType = 'scrobbles'

  // Check current sync state
  const syncState = await getSyncState(user, 'lastfm', dataType)

  // Determine date range
  const end = new Date()
  let start: Date

  if (options.fullResync || !syncState?.last_sync_time) {
    start = options.startDate || subDays(end, DEFAULT_SYNC_HISTORY_DAYS)
  } else {
    start = syncState.last_sync_time
  }

  // Mark as syncing
  await upsertSyncState(user, {
    data_type: dataType,
    provider: 'lastfm',
    status: 'syncing',
    sync_start_date: start,
  })

  try {
    const client = lastfmClient(apiKey)
    const scrobbles = await client.getRecentTracks(username, start, end)

    // Store raw scrobbles and build parallel activity records.
    const activities: Activity[] = []
    for (const scrobble of scrobbles) {
      const externalId = `${scrobble.timestamp.getTime()}-${scrobble.track}-${scrobble.artist}`
      await insertRawRecord(user, {
        data: {
          album: scrobble.album,
          albumMbid: scrobble.albumMbid,
          artist: scrobble.artist,
          artistMbid: scrobble.artistMbid,
          mbid: scrobble.mbid,
          track: scrobble.track,
        },
        external_id: externalId,
        record_type: 'scrobble',
        recorded_at: scrobble.timestamp,
        source: 'lastfm',
      })
      activities.push({
        activity_type: 'music_scrobble',
        data: {
          artist: scrobble.artist,
          ...(scrobble.album ? { album: scrobble.album } : {}),
          track: scrobble.track,
        },
        external_id: externalId,
        source: 'lastfm',
        start_time: scrobble.timestamp,
      })
    }
    await insertActivities(user, activities)

    // Update sync state on success
    await upsertSyncState(user, {
      data_type: dataType,
      last_sync_time: end,
      provider: 'lastfm',
      status: 'idle',
    })

    return {
      scrobbles_processed: scrobbles.length,
      status: 'success',
    }
  } catch (error: unknown) {
    const axiosError = error as { response?: { status?: number; data?: unknown } }

    // Handle specific API errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const statusCode = axiosError.response?.status

    await upsertSyncState(user, {
      data_type: dataType,
      error_message: `${errorMessage}${statusCode ? ` (HTTP ${statusCode})` : ''}`,
      provider: 'lastfm',
      status: 'error',
    })

    return {
      error: errorMessage,
      scrobbles_processed: 0,
      status: 'error',
    }
  }
}
