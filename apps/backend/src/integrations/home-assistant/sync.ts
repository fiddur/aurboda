/**
 * One sync-state row, `provider = 'home_assistant'`, `data_type = 'locations'`.
 * Each run reads the configured entity's history in 24 h slices and stores every
 * state that carries coordinates as a `locations` row. The first run (or a full
 * resync) reaches back 10 days, HA's default recorder retention; later runs start
 * 5 minutes before the last successful sync, because HA commits states to its
 * database with a delay, but never further back than those 10 days: every day
 * of the window is one request to somebody's home server, so a connection that
 * was down for months must not turn into hundreds of them in one scheduler tick.
 * `ON CONFLICT (source, time) DO NOTHING` dedupes.
 */

import type { HomeAssistantSyncResult } from '@aurboda/api-spec'

import { addMinutes, max, subDays, subMinutes } from 'date-fns'

import type { Location, UserSettings } from '../../db/types.ts'
import type { HomeAssistantClient } from './client.ts'

import {
  getAllSyncStates,
  getSyncState,
  insertLocations,
  resetSyncState,
  softDeleteLocationsInTrackedActivities,
  upsertSyncState,
} from '../../db/index.ts'
import { auditError, auditInfo } from '../../services/audit-log.ts'
import { getSettings } from '../../services/settings.ts'
import { activityTrackSources } from '../gps-precedence.ts'
import { historySlices, stateToLocation } from './process.ts'

export const HOME_ASSISTANT_PROVIDER = 'home_assistant'
export const HOME_ASSISTANT_DATA_TYPE = 'locations'
export const HOME_ASSISTANT_SOURCE = 'home_assistant'

export const HOME_ASSISTANT_HISTORY_DAYS = 10
/** How far back a full resync's `start_date` may reach, for a recorder set to keep more than the default. */
export const HOME_ASSISTANT_MAX_HISTORY_DAYS = 366
export const HOME_ASSISTANT_OVERLAP_MINUTES = 5
export const HOME_ASSISTANT_DEFAULT_INTERVAL_MINUTES = 10
/**
 * How long the background poll leaves a failing server alone. A home server is
 * down or unreachable far more often than a cloud API, and without this every
 * scheduler tick would retry it and write an audit entry.
 */
export const HOME_ASSISTANT_ERROR_BACKOFF_MINUTES = 15

export interface HomeAssistantSyncDeps {
  client: HomeAssistantClient
  getSettings: (user: string) => Promise<UserSettings>
  getSyncState: typeof getSyncState
  upsertSyncState: typeof upsertSyncState
  insertLocations: (user: string, locations: Location[]) => Promise<number>
  softDeleteLocationsInTrackedActivities: typeof softDeleteLocationsInTrackedActivities
  auditInfo: typeof auditInfo
  auditError: typeof auditError
  onLocationsSynced?: (user: string, start: Date, end: Date) => void
  now?: () => Date
}

export const defaultHomeAssistantSyncDeps = (
  client: HomeAssistantClient,
  onLocationsSynced?: (user: string, start: Date, end: Date) => void,
): HomeAssistantSyncDeps => ({
  auditError,
  auditInfo,
  client,
  getSettings,
  getSyncState,
  insertLocations,
  onLocationsSynced,
  softDeleteLocationsInTrackedActivities,
  upsertSyncState,
})

export const homeAssistantConnection = (
  settings: UserSettings,
): { baseUrl: string; token: string; entityId: string } | null =>
  settings.home_assistant_url && settings.home_assistant_token && settings.home_assistant_entity_id
    ? {
        baseUrl: settings.home_assistant_url,
        entityId: settings.home_assistant_entity_id,
        token: settings.home_assistant_token,
      }
    : null

const emptyCounts = () => ({ locations_fetched: 0, locations_inserted: 0, locations_superseded: 0 })

type SyncCounts = ReturnType<typeof emptyCounts>

interface SyncRun {
  user: string
  deps: HomeAssistantSyncDeps
  connection: NonNullable<ReturnType<typeof homeAssistantConnection>>
  start: Date
  now: Date
  counts: SyncCounts
}

const syncWindowStart = (
  lastSyncTime: Date | undefined,
  now: Date,
  options: { fullResync?: boolean; startDate?: Date },
): Date => {
  const defaultStart = subDays(now, HOME_ASSISTANT_HISTORY_DAYS)
  if (options.fullResync || !lastSyncTime) {
    return options.startDate
      ? max([options.startDate, subDays(now, HOME_ASSISTANT_MAX_HISTORY_DAYS)])
      : defaultStart
  }
  return max([subMinutes(lastSyncTime, HOME_ASSISTANT_OVERLAP_MINUTES), defaultStart])
}

/** Fetches and stores the window slice by slice; `counts` is filled as it goes, so a failure keeps what was stored. */
const pullWindow = async ({ user, deps, connection, start, now, counts }: SyncRun): Promise<void> => {
  for (const slice of historySlices(start, now)) {
    const states = await deps.client.getHistory(connection, connection.entityId, slice.start, slice.end)
    const locations = states
      .map(stateToLocation)
      .filter((location): location is Location => location !== null)
    counts.locations_fetched += locations.length
    counts.locations_inserted += await deps.insertLocations(user, locations)
  }

  counts.locations_superseded = await deps.softDeleteLocationsInTrackedActivities(
    user,
    HOME_ASSISTANT_SOURCE,
    activityTrackSources,
    start,
    now,
  )
  if (counts.locations_superseded > 0) {
    void deps.auditInfo(
      user,
      'sync',
      `🛰️ Activity GPS took precedence over ${counts.locations_superseded} Home Assistant location point(s)`,
      { end: now.toISOString(), start: start.toISOString() },
    )
  }
}

const recordFailure = async ({ user, deps, now }: SyncRun, message: string): Promise<void> => {
  try {
    await deps.upsertSyncState(user, {
      data_type: HOME_ASSISTANT_DATA_TYPE,
      error_message: message,
      provider: HOME_ASSISTANT_PROVIDER,
      retry_after: addMinutes(now, HOME_ASSISTANT_ERROR_BACKOFF_MINUTES),
      status: 'error',
    })
  } catch (stateError) {
    console.error(`⚠️ Failed to record Home Assistant sync error for ${user}:`, stateError)
  }
  void deps.auditError(user, 'sync', 'Home Assistant sync failed', { error: message })
}

/**
 * Stay detection and deduction rules over the window, when it brought new rows.
 * Also after a failed run: the slices stored before the failure are duplicates
 * to the next run, which would then report nothing new.
 */
const announceNewLocations = ({ user, deps, start, now, counts }: SyncRun): void => {
  if (counts.locations_inserted === 0) return
  void deps.auditInfo(user, 'sync', `Home Assistant: ${counts.locations_inserted} new location point(s)`)
  deps.onLocationsSynced?.(user, start, now)
}

export const syncHomeAssistantLocations = async (
  user: string,
  deps: HomeAssistantSyncDeps,
  options: { fullResync?: boolean; startDate?: Date } = {},
): Promise<HomeAssistantSyncResult> => {
  const counts = emptyCounts()
  const connection = homeAssistantConnection(await deps.getSettings(user))
  if (!connection) return { ...counts, error: 'Home Assistant is not configured', status: 'error' }

  const now = (deps.now ?? (() => new Date()))()
  const run: SyncRun = { connection, counts, deps, now, start: now, user }
  try {
    const state = await deps.getSyncState(user, HOME_ASSISTANT_PROVIDER, HOME_ASSISTANT_DATA_TYPE)
    run.start = syncWindowStart(state?.last_sync_time, now, options)

    await deps.upsertSyncState(user, {
      data_type: HOME_ASSISTANT_DATA_TYPE,
      provider: HOME_ASSISTANT_PROVIDER,
      status: 'syncing',
      sync_start_date: run.start,
    })
    await pullWindow(run)
    await deps.upsertSyncState(user, {
      data_type: HOME_ASSISTANT_DATA_TYPE,
      error_message: undefined,
      last_sync_time: now,
      provider: HOME_ASSISTANT_PROVIDER,
      status: 'idle',
    })
    announceNewLocations(run)
    return { ...counts, status: 'success' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordFailure(run, message)
    announceNewLocations(run)
    return { ...counts, error: message, status: 'error' }
  }
}

export const getHomeAssistantSyncStates = async (user: string) => {
  const states = await getAllSyncStates(user, HOME_ASSISTANT_PROVIDER)
  return states.map((s) => ({
    error_message: s.error_message ?? null,
    last_sync_time: s.last_sync_time?.toISOString() ?? null,
    provider: HOME_ASSISTANT_PROVIDER,
    retry_after: s.retry_after?.toISOString() ?? null,
    status: s.status === 'rate_limited' ? ('error' as const) : (s.status ?? 'idle'),
  }))
}

/** Forgets the last sync time too, so the next run is a first sync: the same as `reset_sync_state` over MCP. */
export const resetHomeAssistantSyncState = (user: string): Promise<void> =>
  resetSyncState(user, HOME_ASSISTANT_PROVIDER, HOME_ASSISTANT_DATA_TYPE)
