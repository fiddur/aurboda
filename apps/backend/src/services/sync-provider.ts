/**
 * Sync provider factory for auto-syncing external data sources.
 *
 * This module creates SyncProvider instances that can be passed to query
 * functions to enable automatic data refresh before queries.
 */

import { isBefore, subMinutes } from 'date-fns'
import { getSyncState } from '../db'
import { syncAllCalendars } from '../ical-sync'
import { ouraClient } from '../oura'
import { isRateLimited as isOuraRateLimited, OuraDataType, syncOuraDataType } from '../oura-sync'
import {
  isRateLimited as isRescueTimeRateLimited,
  needsSync as rescueTimeNeedsSync,
  syncRescueTimeData,
} from '../rescuetime-sync'
import { SyncProvider } from './queries'
import { getSettings } from './settings'

/** Default sync threshold - sync if last sync was more than 30 minutes ago */
const DEFAULT_SYNC_THRESHOLD_MINUTES = 30

type OuraClientType = ReturnType<typeof ouraClient>

export interface SyncProviderConfig {
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
        if (syncState?.lastSyncTime && isBefore(thresholdTime, syncState.lastSyncTime)) {
          return
        }

        console.log('Auto-syncing calendars...')
        await syncAllCalendars(user, settings.calendars)
      } catch (error) {
        console.error('Failed to auto-sync calendars:', error)
      }
    },

    syncOuraIfNeeded: async (user: string, dataType: 'tags' | 'sessions'): Promise<void> => {
      if (!config.oura) return

      try {
        const ouraDataType: OuraDataType = dataType
        const syncState = await getSyncState(user, 'oura', ouraDataType)

        // Skip if rate limited
        if (isOuraRateLimited(syncState)) {
          console.log(`Oura ${dataType} sync skipped - rate limited until ${syncState?.retryAfter}`)
          return
        }

        // Check if sync is needed (never synced or older than threshold)
        const thresholdTime = subMinutes(new Date(), threshold)
        if (syncState?.lastSyncTime && isBefore(thresholdTime, syncState.lastSyncTime)) {
          return // Recently synced, no need to sync again
        }

        console.log(`Auto-syncing Oura ${dataType}...`)
        const accessToken = await config.oura.getAccessToken(user)
        await syncOuraDataType(user, config.oura, ouraDataType, accessToken)
      } catch (error) {
        console.error(`Failed to auto-sync Oura ${dataType}:`, error)
      }
    },

    syncRescueTimeIfNeeded: async (user: string): Promise<void> => {
      try {
        const settings = await getSettings(user)
        if (!settings.rescueTimeKey) return

        const syncState = await getSyncState(user, 'rescuetime', 'productivity')

        if (isRescueTimeRateLimited(syncState)) return
        if (!rescueTimeNeedsSync(syncState, threshold)) return

        console.log('Auto-syncing RescueTime productivity...')
        await syncRescueTimeData(user, settings.rescueTimeKey)
      } catch (error) {
        console.error('Failed to auto-sync RescueTime:', error)
      }
    },
  }
}
