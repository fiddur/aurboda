/**
 * `/sync` router wiring: assembles the dependency object passed to
 * `createSyncRouter` from per-provider sync functions and central-DB-backed
 * settings. Each transform here normalizes the per-provider sync result
 * (Date → ISO string, undefined → null) for the cross-provider response shape.
 */
import type { Express } from 'express'

import type { GarminClient } from '../integrations/garmin/client.ts'
import type { ouraClient } from '../integrations/oura/client.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { ActivityNotifier } from '../services/deduction-queue.ts'
import type { StravaQueue } from '../services/strava-queue.ts'
import type { AnyMiddleware } from '../typed-router.ts'

import {
  ackOutboundSync,
  deleteHealthConnectRecords,
  getAllSyncStates,
  getOutboundSyncHistory,
  getPendingOutboundSync,
  processDailyAggregate,
  processHealthConnectBatch,
  processHealthConnectData,
  reportSyncFailure,
  requeueOutboundSync,
  resetSyncState,
  upsertUserSettings,
} from '../db/index.ts'
import { processActivityWatchEvents } from '../integrations/activitywatch/sync.ts'
import { syncAllGarminData } from '../integrations/garmin/sync.ts'
import { syncAllCalendars } from '../integrations/ical/sync.ts'
import { syncLastFmData } from '../integrations/lastfm/sync.ts'
import { syncAllOuraData } from '../integrations/oura/sync.ts'
import { syncRescueTimeData } from '../integrations/rescuetime/sync.ts'
import { getStravaSyncStates, resetStravaSyncState, syncStrava } from '../integrations/strava/sync.ts'
import { triggerCalorieComputation } from '../services/calorie-computation.ts'
import { getSettings } from '../services/settings.ts'
import { createSyncRouter } from '../sync-router.ts'

type OuraClient = ReturnType<typeof ouraClient>

interface SyncSetupDeps {
  httpd: Express
  authMiddleware: AnyMiddleware
  centralDb: CentralDb
  oura: OuraClient
  garmin: GarminClient
  stravaQueue: StravaQueue | null
  activityNotifier: ActivityNotifier
}

export const mountSyncRouter = ({
  httpd,
  authMiddleware,
  centralDb,
  oura,
  garmin,
  stravaQueue,
  activityNotifier,
}: SyncSetupDeps): void => {
  // Transform SyncState to ProviderSyncStatus format (undefined -> null)
  const transformSyncStates = async (user: string, provider: string) => {
    const states = await getAllSyncStates(user, provider)
    return states.map((s) => ({
      error_message: s.error_message ?? null,
      last_sync_time: s.last_sync_time?.toISOString() ?? null,
      provider: s.provider,
      retry_after: s.retry_after?.toISOString() ?? null,
      status: s.status === 'rate_limited' ? ('error' as const) : s.status,
    }))
  }

  const transformOuraSyncResults = async (
    user: string,
    options: { fullResync?: boolean; startDate?: Date },
  ) => {
    const results = await syncAllOuraData(user, oura, options)
    return results.map((r) => ({
      ...r,
      retry_after: r.retry_after?.toISOString(),
    }))
  }

  const transformRescueTimeSyncResult = async (
    user: string,
    apiKey: string,
    options: { fullResync?: boolean; startDate?: Date },
  ) => {
    const result = await syncRescueTimeData(user, apiKey, options)
    return {
      ...result,
      retry_after: result.retry_after?.toISOString(),
    }
  }

  const transformLastFmSyncResult = async (
    user: string,
    apiKey: string,
    username: string,
    options: { fullResync?: boolean; startDate?: Date },
  ) => {
    return await syncLastFmData(user, apiKey, username, options)
  }

  httpd.use(
    '/sync',
    createSyncRouter(
      {
        ackOutboundSync,
        deleteHealthConnectRecords,
        getOutboundSyncHistory,
        getActivityWatchSyncStates: (user) => transformSyncStates(user, 'activitywatch'),
        getCalendarSyncStates: (user) => transformSyncStates(user, 'calendar'),
        getGarminSyncStates: (user) => transformSyncStates(user, 'garmin'),
        getLastFmApiKey: () => centralDb.getLastFmApiKey(),
        getLastFmSyncStates: (user) => transformSyncStates(user, 'lastfm'),
        getOuraSyncStates: (user) => transformSyncStates(user, 'oura'),
        getPendingOutboundSync,
        getRescueTimeSyncStates: (user) => transformSyncStates(user, 'rescuetime'),
        getSettings,
        processActivityWatchEvents,
        processDailyAggregate,
        processHealthConnectBatch,
        processHealthConnectData,
        reportSyncFailure,
        requeueOutboundSync,
        resetCalendarSyncState: (user) => resetSyncState(user, 'calendar'),
        resetGarminSyncState: (user, dataType) => resetSyncState(user, 'garmin', dataType),
        resetLastFmSyncState: (user) => resetSyncState(user, 'lastfm'),
        resetOuraSyncState: (user, dataType) => resetSyncState(user, 'oura', dataType),
        resetRescueTimeSyncState: (user) => resetSyncState(user, 'rescuetime'),
        resetStravaSyncState,
        getStravaSyncStates,
        getStravaQueueStatus: stravaQueue ? () => stravaQueue.getStatus() : undefined,
        syncStrava: async (user, options) => {
          if (!stravaQueue) throw new Error('Strava integration not configured')
          return syncStrava(user, stravaQueue, options)
        },
        syncCalendars: (user, calendars) => syncAllCalendars(user, calendars),
        syncGarmin: async (user, options) => {
          const results = await syncAllGarminData(user, garmin, options)
          return results.map((r) => ({
            ...r,
            retry_after: r.retry_after?.toISOString(),
          }))
        },
        syncLastFm: transformLastFmSyncResult,
        syncOura: transformOuraSyncResults,
        syncRescueTime: transformRescueTimeSyncResult,
        triggerCalorieComputation: (user: string, start: Date, end: Date) =>
          triggerCalorieComputation(user, start, end),
        upsertUserSettings: (user: string, settings: Record<string, unknown>) =>
          upsertUserSettings(user, settings),
        onActivitySynced: activityNotifier,
      },
      authMiddleware,
    ),
  )
}
