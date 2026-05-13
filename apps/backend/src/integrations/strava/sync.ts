/**
 * Strava sync orchestration.
 *
 * Unlike Oura/Garmin which directly call APIs during sync,
 * Strava sync enqueues jobs into the pg-boss queue and returns immediately
 * (fire-and-forget, 202 pattern like Garmin).
 *
 * The queue processor handles rate limiting and actual API calls.
 */

import type { StravaSyncResult } from '@aurboda/api-spec'

import type { StravaQueue } from '../../services/strava-queue.ts'

import { getAllSyncStates, getOAuthToken, getSyncState, upsertSyncState } from '../../db/index.ts'

export const syncStrava = async (
  user: string,
  queue: StravaQueue,
  options: { fullResync?: boolean },
): Promise<StravaSyncResult> => {
  // Check if Strava is connected
  const token = await getOAuthToken(user, 'strava')
  if (!token) {
    return { status: 'not_connected' }
  }

  // Check if already syncing
  const syncState = await getSyncState(user, 'strava', 'activities')
  if (syncState?.status === 'syncing') {
    return { status: 'already_syncing' }
  }

  // Mark as syncing
  await upsertSyncState(user, {
    data_type: 'activities',
    provider: 'strava',
    status: 'syncing',
  })

  // Determine the `after` timestamp for incremental sync
  const after = options.fullResync
    ? undefined
    : syncState?.last_sync_time
      ? Math.floor(syncState.last_sync_time.getTime() / 1000)
      : undefined

  // Enqueue the sync job
  await queue.enqueueSync(user, { after, fullResync: options.fullResync })

  return { status: options.fullResync ? 'queued' : 'syncing' }
}

export const getStravaSyncStates = async (user: string) => {
  const states = await getAllSyncStates(user, 'strava')

  return states.map((s) => ({
    error_message: s.error_message ?? null,
    last_sync_time: s.last_sync_time?.toISOString() ?? null,
    provider: 'strava',
    retry_after: s.retry_after?.toISOString() ?? null,
    status: s.status ?? 'idle',
  }))
}

export const resetStravaSyncState = async (user: string, dataType?: string): Promise<void> => {
  if (dataType) {
    await upsertSyncState(user, {
      data_type: dataType,
      error_message: undefined,
      provider: 'strava',
      retry_after: undefined,
      status: 'idle',
    })
  } else {
    for (const dt of ['activities', 'activity_details']) {
      await upsertSyncState(user, {
        data_type: dt,
        error_message: undefined,
        provider: 'strava',
        retry_after: undefined,
        status: 'idle',
      })
    }
  }
}
