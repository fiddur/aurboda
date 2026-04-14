/**
 * Sync provider factory for auto-syncing external data sources.
 *
 * This module creates SyncProvider instances that can be passed to query
 * functions to enable automatic data refresh before queries.
 */

import { isBefore, subMinutes } from 'date-fns'

import type { GarminClient } from '../integrations/garmin/client.ts'
import type { ouraClient } from '../integrations/oura/client.ts'
import type { SyncProvider } from './queries/index.ts'

import { getSyncState } from '../db/index.ts'
import {
  type GarminDataType,
  isRateLimited as isGarminRateLimited,
  syncActivityDetails,
  syncGarminDataType,
} from '../integrations/garmin/sync.ts'
import { syncAllCalendars } from '../integrations/ical/sync.ts'
import { syncLastFmData } from '../integrations/lastfm/sync.ts'
import {
  isRateLimited as isOuraRateLimited,
  type OuraDataType,
  syncOuraDataType,
} from '../integrations/oura/sync.ts'
import {
  isRateLimited as isRescueTimeRateLimited,
  needsSync as rescueTimeNeedsSync,
  syncRescueTimeData,
} from '../integrations/rescuetime/sync.ts'
import { auditError, auditInfo, auditWarn } from './audit-log.ts'
import { getSettings } from './settings.ts'

/** Default sync threshold - sync if last sync was more than 30 minutes ago */
const DEFAULT_SYNC_THRESHOLD_MINUTES = 30

type OuraClientType = ReturnType<typeof ouraClient>

export interface SyncProviderConfig {
  /** Garmin Connect client (optional - if not provided, Garmin sync is disabled) */
  garmin?: GarminClient
  /** Callback to get the Last.fm API key (optional - if not provided, Last.fm sync is disabled) */
  getLastFmApiKey?: () => Promise<string | null>
  /** Oura API client (optional - if not provided, Oura sync is disabled) */
  oura?: OuraClientType
  /** Sync threshold in minutes (default: 30) */
  syncThresholdMinutes?: number
}

/**
 * Create a sync provider with the given configuration.
 * The provider can be passed to query functions to enable auto-sync.
 */
export function createSyncProvider(config: SyncProviderConfig): SyncProvider {
  const threshold = config.syncThresholdMinutes ?? DEFAULT_SYNC_THRESHOLD_MINUTES

  return {
    syncCalendarsIfNeeded: async (user: string): Promise<void> => {
      try {
        const settings = await getSettings(user)
        if (!settings.calendars || settings.calendars.length === 0) return

        // Check if any calendar needs sync by checking the first one
        // (they all get synced together)
        const syncState = await getSyncState(user, 'calendar', settings.calendars[0].name)
        const thresholdTime = subMinutes(new Date(), threshold)
        if (syncState?.last_sync_time && isBefore(thresholdTime, syncState.last_sync_time)) {
          return
        }

        auditInfo(user, 'sync', 'Auto-syncing calendars')
        await syncAllCalendars(user, settings.calendars)
      } catch (error) {
        auditError(user, 'sync', 'Failed to auto-sync calendars', { error: String(error) })
      }
    },

    syncGarminIfNeeded: async (user: string, dataType: string): Promise<void> => {
      if (!config.garmin) return

      try {
        // Check if this data type is disabled in user settings
        const settings = await getSettings(user)
        if (settings.garmin_disabled_data_types?.includes(dataType as GarminDataType)) return

        const syncState = await getSyncState(user, 'garmin', dataType)

        if (isGarminRateLimited(syncState)) {
          auditWarn(user, 'sync', `Garmin ${dataType} sync skipped - rate limited`, {
            retry_after: syncState?.retry_after?.toISOString(),
          })
          return
        }

        const thresholdTime = subMinutes(new Date(), threshold)
        if (syncState?.last_sync_time && isBefore(thresholdTime, syncState.last_sync_time)) {
          return
        }

        auditInfo(user, 'sync', `Auto-syncing Garmin ${dataType}`)
        await syncGarminDataType(user, config.garmin, dataType as GarminDataType)

        // After syncing activities, also fetch per-second detail data (GPS, HR, etc.)
        if (dataType === 'activities') {
          await syncActivityDetails(user, config.garmin)
        }
      } catch (error) {
        auditError(user, 'sync', `Failed to auto-sync Garmin ${dataType}`, { error: String(error) })
      }
    },

    syncLastFmIfNeeded: async (user: string): Promise<void> => {
      if (!config.getLastFmApiKey) return

      try {
        const settings = await getSettings(user)
        if (!settings.lastfm_username) return

        const apiKey = await config.getLastFmApiKey()
        if (!apiKey) return

        const syncState = await getSyncState(user, 'lastfm', 'scrobbles')
        const thresholdTime = subMinutes(new Date(), threshold)
        if (syncState?.last_sync_time && isBefore(thresholdTime, syncState.last_sync_time)) {
          return
        }

        auditInfo(user, 'sync', 'Auto-syncing Last.fm scrobbles')
        await syncLastFmData(user, apiKey, settings.lastfm_username)
      } catch (error) {
        auditError(user, 'sync', 'Failed to auto-sync Last.fm', { error: String(error) })
      }
    },

    syncOuraIfNeeded: async (user: string, dataType: 'tags' | 'sessions'): Promise<void> => {
      if (!config.oura) return

      try {
        const ouraDataType: OuraDataType = dataType
        const syncState = await getSyncState(user, 'oura', ouraDataType)

        // Skip if rate limited
        if (isOuraRateLimited(syncState)) {
          auditWarn(user, 'sync', `Oura ${dataType} sync skipped - rate limited`, {
            retry_after: syncState?.retry_after?.toISOString(),
          })
          return
        }

        // Check if sync is needed (never synced or older than threshold)
        const thresholdTime = subMinutes(new Date(), threshold)
        if (syncState?.last_sync_time && isBefore(thresholdTime, syncState.last_sync_time)) {
          return // Recently synced, no need to sync again
        }

        auditInfo(user, 'sync', `Auto-syncing Oura ${dataType}`)
        const accessToken = await config.oura.getAccessToken(user)
        await syncOuraDataType(user, config.oura, ouraDataType, accessToken)
      } catch (error) {
        auditError(user, 'sync', `Failed to auto-sync Oura ${dataType}`, { error: String(error) })
      }
    },

    syncRescueTimeIfNeeded: async (user: string): Promise<void> => {
      try {
        const settings = await getSettings(user)
        if (!settings.rescue_time_key) return

        const syncState = await getSyncState(user, 'rescuetime', 'productivity')

        if (isRescueTimeRateLimited(syncState)) return
        if (!rescueTimeNeedsSync(syncState, threshold)) return

        auditInfo(user, 'sync', 'Auto-syncing RescueTime productivity')
        await syncRescueTimeData(user, settings.rescue_time_key)
      } catch (error) {
        auditError(user, 'sync', 'Failed to auto-sync RescueTime', { error: String(error) })
      }
    },
  }
}
