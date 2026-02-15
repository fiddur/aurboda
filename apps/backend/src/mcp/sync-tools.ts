/**
 * MCP sync tools - data synchronization with external services.
 */
import {
  syncCalendarsBodySchema,
  syncLastFmBodySchema,
  syncOuraBodySchema,
  syncProviderSchema,
  syncRescueTimeBodySchema,
} from '@aurboda/api-spec'
import { getAllSyncStates } from '../db'
import { syncAllCalendars } from '../ical-sync'
import { syncLastFmData } from '../lastfm-sync'
import { ouraClient } from '../oura'
import { syncAllOuraData } from '../oura-sync'
import { syncRescueTimeData } from '../rescuetime-sync'
import { getCentralDb } from '../services/central-db'
import { getSettings } from '../services/settings'
import { errorResponse, jsonResponse, type McpServer } from './helpers'

type OuraClient = ReturnType<typeof ouraClient>

// eslint-disable-next-line max-lines-per-function -- tool registrations are inherently long
export const registerSyncTools = (server: McpServer, user: string, oura?: OuraClient) => {
  // Tool: sync_oura
  server.tool(
    'sync_oura',
    'Sync data from Oura Ring API. Fetches cardiovascular age, readiness, resilience, sleep scores, meditation sessions, and tags.',
    { ...syncOuraBodySchema.shape },
    async ({ full_resync, start_date }) => {
      if (!oura) {
        return errorResponse('Oura integration is not configured on this server.')
      }

      try {
        const results = await syncAllOuraData(user, oura, {
          fullResync: full_resync,
          startDate: start_date ? new Date(start_date) : undefined,
        })

        const summary = results.map((r) => ({
          data_type: r.data_type,
          error: r.error,
          records_processed: r.records_processed,
          status: r.status,
        }))

        return jsonResponse({ results: summary, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return jsonResponse({ error: message, success: false })
      }
    },
  )

  // Tool: sync_rescuetime
  server.tool(
    'sync_rescuetime',
    'Sync productivity data from RescueTime API. Fetches application and website usage with productivity scores.',
    { ...syncRescueTimeBodySchema.shape },
    async ({ full_resync, start_date }) => {
      const settings = await getSettings(user)
      if (!settings.rescue_time_key) {
        return errorResponse('RescueTime API key is not configured in user settings.')
      }

      try {
        const result = await syncRescueTimeData(user, settings.rescue_time_key, {
          fullResync: full_resync,
          startDate: start_date ? new Date(start_date) : undefined,
        })

        return jsonResponse({
          error: result.error,
          records_processed: result.records_processed,
          status: result.status,
          success: result.status === 'success',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return jsonResponse({ error: message, success: false })
      }
    },
  )

  // Tool: sync_calendars
  server.tool(
    'sync_calendars',
    'Sync events from configured calendar ICS URLs. Fetches ICS data and stores events as tags for correlation analysis.',
    { ...syncCalendarsBodySchema.shape },
    async () => {
      const settings = await getSettings(user)
      if (!settings.calendars || settings.calendars.length === 0) {
        return errorResponse('No calendars configured in user settings. Add calendars in Settings first.')
      }

      try {
        const results = await syncAllCalendars(user, settings.calendars)

        const summary = results.map((r) => ({
          calendar: r.calendar,
          error: r.error,
          events_processed: r.events_processed,
          status: r.status,
        }))

        return jsonResponse({ results: summary, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return jsonResponse({ error: message, success: false })
      }
    },
  )

  // Tool: sync_lastfm
  server.tool(
    'sync_lastfm',
    'Sync scrobbles from Last.fm. Fetches recent tracks and applies auto-tagging rules.',
    { ...syncLastFmBodySchema.shape },
    async ({ full_resync, start_date }) => {
      const lastFmApiKey = await getCentralDb().getLastFmApiKey()
      if (!lastFmApiKey) {
        return errorResponse('Last.fm API key is not configured on this server.')
      }

      const settings = await getSettings(user)
      if (!settings.lastfm_username) {
        return errorResponse('Last.fm username is not configured in user settings.')
      }

      try {
        const result = await syncLastFmData(user, lastFmApiKey, settings.lastfm_username, {
          fullResync: full_resync,
          startDate: start_date ? new Date(start_date) : undefined,
        })

        return jsonResponse({
          error: result.error,
          scrobbles_processed: result.scrobbles_processed,
          status: result.status,
          success: result.status === 'success',
          tags_created: result.tags_created,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return jsonResponse({ error: message, success: false })
      }
    },
  )

  // Tool: get_sync_status
  server.tool(
    'get_sync_status',
    'Get the current sync status for Oura, RescueTime, Calendar, and Last.fm data sources. Shows last sync time, status, and any errors.',
    {
      provider: syncProviderSchema.optional().describe('Which provider to check. Defaults to "all".'),
    },
    async ({ provider = 'all' }) => {
      try {
        const states: Record<string, unknown[]> = {}

        if (provider === 'all' || provider === 'oura') {
          states.oura = await getAllSyncStates(user, 'oura')
        }

        if (provider === 'all' || provider === 'rescuetime') {
          states.rescuetime = await getAllSyncStates(user, 'rescuetime')
        }

        if (provider === 'all' || provider === 'calendar') {
          states.calendar = await getAllSyncStates(user, 'calendar')
        }

        if (provider === 'all' || provider === 'lastfm') {
          states.lastfm = await getAllSyncStates(user, 'lastfm')
        }

        return jsonResponse({ states, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return jsonResponse({ error: message, success: false })
      }
    },
  )
}
