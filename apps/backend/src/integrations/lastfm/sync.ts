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
export const DEFAULT_SYNC_HISTORY_DAYS = 30

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

    // Build activity records first, then persist in two phases:
    //   1) bulk insert activities — single SQL, all-or-nothing
    //   2) loop over raw_records — individual upserts
    // Activities go first so a mid-sync crash can't leave raw records persisted
    // without matching activities. The raw_records dedup would then skip
    // re-fetching on the next sync, which is why the backfill migration must
    // otherwise fix things up later. Doing activities first avoids that gap.
    const activities: Activity[] = scrobbles.map((scrobble) => ({
      activity_type: 'music_scrobble',
      data: {
        artist: scrobble.artist,
        ...(scrobble.album ? { album: scrobble.album } : {}),
        track: scrobble.track,
      },
      external_id: `${scrobble.timestamp.getTime()}-${scrobble.track}-${scrobble.artist}`,
      source: 'lastfm',
      start_time: scrobble.timestamp,
    }))
    await insertActivities(user, activities)

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
    }

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
