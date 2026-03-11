import {
  dailyAggregatesBodySchema,
  healthConnectDeletionsBodySchema,
  healthConnectSyncBodySchema,
  outboundSyncAckBodySchema,
  syncActivityWatchBodySchema,
  syncCalendarsBodySchema,
  syncLastFmBodySchema,
  syncOuraBodySchema,
  syncRescueTimeBodySchema,
  type ActivityWatchSyncResponse,
  type ActivityWatchSyncResult,
  type ActivityWatchSyncStatusResponse,
  type CalendarConfig,
  type CalendarSyncResponse,
  type CalendarSyncResult,
  type CalendarSyncStatusResponse,
  type DailyAggregate,
  type DailyAggregatesBody,
  type HealthConnectDeletionsBody,
  type HealthConnectRecord,
  type HealthConnectSyncBody,
  type LastFmSyncResponse,
  type LastFmSyncResult,
  type LastFmSyncStatusResponse,
  type OuraSyncResponse,
  type OuraSyncResult,
  type OuraSyncStatusResponse,
  type OutboundSyncAckBody,
  type OutboundSyncAckResponse,
  type OutboundSyncResponse,
  type ProviderSyncStatus,
  type RescueTimeSyncResponse,
  type RescueTimeSyncResult,
  type RescueTimeSyncStatusResponse,
  type SyncActivityWatchBody,
  type SyncCalendarsBody,
  type SyncLastFmBody,
  type SyncOuraBody,
  type SyncRescueTimeBody,
  type SyncResponse,
} from '@aurboda/api-spec'
import { RequestHandler, Router } from 'express'
import type { ParamsDictionary } from 'express-serve-static-core'
import { validateBody } from './validation'

/**
 * Dependencies for sync router - allows testing with mocks
 */
interface OutboundSyncEntry {
  id: string
  entity_type: string
  entity_id: string
  operation: 'insert' | 'update' | 'delete'
  hc_record_type: string
  payload: Record<string, unknown>
  hc_record_id?: string
  status: 'pending' | 'synced' | 'failed'
  created_at: Date
  synced_at?: Date
}

export interface SyncRouterDeps {
  deleteHealthConnectRecords: (user: string, externalIds: string[]) => Promise<number>
  processDailyAggregate: (user: string, aggregate: DailyAggregate) => Promise<void>
  processHealthConnectData: (user: string, recordType: string, data: HealthConnectRecord) => Promise<void>
  triggerCalorieComputation: (user: string, start: Date, end: Date) => Promise<void>
  syncOura: (user: string, options: { fullResync?: boolean; startDate?: Date }) => Promise<OuraSyncResult[]>
  getOuraSyncStates: (user: string) => Promise<ProviderSyncStatus[]>
  resetOuraSyncState: (user: string, dataType?: string) => Promise<void>
  syncRescueTime: (
    user: string,
    apiKey: string,
    options: { fullResync?: boolean; startDate?: Date },
  ) => Promise<RescueTimeSyncResult>
  getRescueTimeSyncStates: (user: string) => Promise<ProviderSyncStatus[]>
  resetRescueTimeSyncState: (user: string) => Promise<void>
  syncCalendars: (
    user: string,
    calendars: CalendarConfig[],
    options: { fullResync?: boolean },
  ) => Promise<CalendarSyncResult[]>
  getCalendarSyncStates: (user: string) => Promise<ProviderSyncStatus[]>
  resetCalendarSyncState: (user: string) => Promise<void>
  syncLastFm: (
    user: string,
    apiKey: string,
    username: string,
    options: { fullResync?: boolean; startDate?: Date },
  ) => Promise<LastFmSyncResult>
  getLastFmSyncStates: (user: string) => Promise<ProviderSyncStatus[]>
  resetLastFmSyncState: (user: string) => Promise<void>
  getSettings: (
    user: string,
  ) => Promise<{ rescue_time_key?: string; calendars?: CalendarConfig[]; lastfm_username?: string }>
  getLastFmApiKey: () => Promise<string | null>
  processActivityWatchEvents: (
    user: string,
    events: SyncActivityWatchBody['events'],
    deviceName: string,
    isMobile?: boolean,
  ) => Promise<ActivityWatchSyncResult>
  getActivityWatchSyncStates: (user: string) => Promise<ProviderSyncStatus[]>
  // Outbound sync (Health Connect write-back)
  getPendingOutboundSync: (user: string, limit?: number) => Promise<OutboundSyncEntry[]>
  ackOutboundSync: (user: string, id: string, hcRecordId?: string) => Promise<boolean>
}

/**
 * Creates the sync router with all /sync/* endpoints.
 *
 * IMPORTANT: Route order matters! Specific routes must be defined BEFORE
 * the generic /sync/:recordType route to avoid Express matching issues.
 */
export const createSyncRouter = (deps: SyncRouterDeps, authMiddleware: RequestHandler): Router => {
  const router = Router()

  // ===========================================================================
  // Specific sync routes - MUST be defined BEFORE /sync/:recordType
  // ===========================================================================

  // Daily aggregates endpoint for deduplicated cumulative metrics from Health Connect
  router.post<ParamsDictionary, SyncResponse, DailyAggregatesBody>(
    '/daily-aggregates',
    authMiddleware,
    validateBody(dailyAggregatesBodySchema),
    async (req, res) => {
      const { data } = req.body
      const user = req.user!

      const metrics = [...new Set(data.map((a) => a.metric))]
      const dates = [...new Set(data.map((a) => a.date))].sort()
      console.log(
        `📊 Daily aggregates received: ${data.length} entries for [${metrics.join(', ')}] ` +
          `dates ${dates[0]}..${dates[dates.length - 1]}`,
      )

      for (const aggregate of data) {
        await deps.processDailyAggregate(user, aggregate)
      }

      res.json({ success: true })
    },
  )

  // Oura sync endpoints
  router.post<ParamsDictionary, OuraSyncResponse, SyncOuraBody>(
    '/oura',
    authMiddleware,
    validateBody(syncOuraBodySchema),
    async (req, res) => {
      const user = req.user!
      const { full_resync, start_date } = req.body

      try {
        const results = await deps.syncOura(user, {
          fullResync: full_resync,
          startDate: start_date ? new Date(start_date) : undefined,
        })

        res.json({ results, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  router.get<ParamsDictionary, OuraSyncStatusResponse>('/oura/status', authMiddleware, async (req, res) => {
    const user = req.user!

    try {
      const states = await deps.getOuraSyncStates(user)
      res.json({ states, success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  router.delete<ParamsDictionary, SyncResponse, unknown, { dataType?: string }>(
    '/oura/state',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const { dataType } = req.query

      try {
        await deps.resetOuraSyncState(user, dataType)
        res.json({ success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  // RescueTime sync endpoints
  router.post<ParamsDictionary, RescueTimeSyncResponse, SyncRescueTimeBody>(
    '/rescuetime',
    authMiddleware,
    validateBody(syncRescueTimeBodySchema),
    async (req, res) => {
      const user = req.user!
      const { full_resync, start_date } = req.body
      const settings = await deps.getSettings(user)
      const rescueTimeKey = settings.rescue_time_key

      if (!rescueTimeKey) {
        return res
          .status(400)
          .json({ error: 'RescueTime API key not configured in user settings', success: false })
      }

      try {
        const result = await deps.syncRescueTime(user, rescueTimeKey, {
          fullResync: full_resync,
          startDate: start_date ? new Date(start_date) : undefined,
        })

        res.json({ result, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  router.get<ParamsDictionary, RescueTimeSyncStatusResponse>(
    '/rescuetime/status',
    authMiddleware,
    async (req, res) => {
      const user = req.user!

      try {
        const states = await deps.getRescueTimeSyncStates(user)
        res.json({ states, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  router.delete<ParamsDictionary, SyncResponse>('/rescuetime/state', authMiddleware, async (req, res) => {
    const user = req.user!

    try {
      await deps.resetRescueTimeSyncState(user)
      res.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  // Calendar sync endpoints
  router.post<ParamsDictionary, CalendarSyncResponse, SyncCalendarsBody>(
    '/calendars',
    authMiddleware,
    validateBody(syncCalendarsBodySchema),
    async (req, res) => {
      const user = req.user!
      const { full_resync } = req.body
      const settings = await deps.getSettings(user)
      const calendars = settings.calendars

      if (!calendars || calendars.length === 0) {
        return res.status(400).json({ error: 'No calendars configured in user settings', success: false })
      }

      try {
        const results = await deps.syncCalendars(user, calendars, { fullResync: full_resync })
        res.json({ results, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  router.get<ParamsDictionary, CalendarSyncStatusResponse>(
    '/calendars/status',
    authMiddleware,
    async (req, res) => {
      const user = req.user!

      try {
        const states = await deps.getCalendarSyncStates(user)
        res.json({ states, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  router.delete<ParamsDictionary, SyncResponse>('/calendars/state', authMiddleware, async (req, res) => {
    const user = req.user!

    try {
      await deps.resetCalendarSyncState(user)
      res.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  // Last.fm sync endpoints
  router.post<ParamsDictionary, LastFmSyncResponse, SyncLastFmBody>(
    '/lastfm',
    authMiddleware,
    validateBody(syncLastFmBodySchema),
    async (req, res) => {
      const user = req.user!
      const { full_resync, start_date } = req.body

      const lastFmApiKey = await deps.getLastFmApiKey()
      if (!lastFmApiKey) {
        return res.status(400).json({ error: 'Last.fm API key not configured on server', success: false })
      }

      const settings = await deps.getSettings(user)
      const lastFmUsername = settings.lastfm_username

      if (!lastFmUsername) {
        return res
          .status(400)
          .json({ error: 'Last.fm username not configured in user settings', success: false })
      }

      try {
        const result = await deps.syncLastFm(user, lastFmApiKey, lastFmUsername, {
          fullResync: full_resync,
          startDate: start_date ? new Date(start_date) : undefined,
        })

        res.json({ result, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  router.get<ParamsDictionary, LastFmSyncStatusResponse>(
    '/lastfm/status',
    authMiddleware,
    async (req, res) => {
      const user = req.user!

      try {
        const states = await deps.getLastFmSyncStates(user)
        res.json({ states, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  router.delete<ParamsDictionary, SyncResponse>('/lastfm/state', authMiddleware, async (req, res) => {
    const user = req.user!

    try {
      await deps.resetLastFmSyncState(user)
      res.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  // ActivityWatch push sync endpoints
  router.post<ParamsDictionary, ActivityWatchSyncResponse, SyncActivityWatchBody>(
    '/activitywatch',
    authMiddleware,
    validateBody(syncActivityWatchBodySchema),
    async (req, res) => {
      const user = req.user!
      const { events, device_name, is_mobile } = req.body
      const deviceName = device_name ?? ''

      try {
        const result = await deps.processActivityWatchEvents(user, events, deviceName, is_mobile)
        res.json({ result, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  router.get<ParamsDictionary, ActivityWatchSyncStatusResponse>(
    '/activitywatch/status',
    authMiddleware,
    async (req, res) => {
      const user = req.user!

      try {
        const states = await deps.getActivityWatchSyncStates(user)
        res.json({ states, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  // ===========================================================================
  // Outbound sync endpoints (Health Connect write-back)
  // ===========================================================================

  // Get pending outbound sync entries for the Android app to write to Health Connect
  router.get<ParamsDictionary, OutboundSyncResponse>('/outbound', authMiddleware, async (req, res) => {
    const user = req.user!

    try {
      const entries = await deps.getPendingOutboundSync(user)
      const data = entries.map((e) => ({
        ...e,
        created_at: e.created_at.toISOString(),
        synced_at: e.synced_at?.toISOString(),
      }))
      res.json({ data, success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  // Acknowledge that outbound sync entries were written to Health Connect
  router.post<ParamsDictionary, OutboundSyncAckResponse, OutboundSyncAckBody>(
    '/outbound/ack',
    authMiddleware,
    validateBody(outboundSyncAckBodySchema),
    async (req, res) => {
      const user = req.user!
      const { entries } = req.body

      try {
        let acknowledged = 0
        for (const entry of entries) {
          const ok = await deps.ackOutboundSync(user, entry.id, entry.hc_record_id)
          if (ok) acknowledged++
        }
        res.json({ acknowledged, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  // Health Connect deletions endpoint
  router.post<ParamsDictionary, SyncResponse, HealthConnectDeletionsBody>(
    '/deletions',
    authMiddleware,
    validateBody(healthConnectDeletionsBodySchema),
    async (req, res) => {
      const { data } = req.body
      const user = req.user!

      const deleted = await deps.deleteHealthConnectRecords(user, data)
      res.json({ message: `Deleted ${deleted} records`, success: true })
    },
  )

  // ===========================================================================
  // Generic Health Connect sync endpoint - MUST be defined AFTER specific routes
  // ===========================================================================
  router.post<{ recordType: string }, SyncResponse, HealthConnectSyncBody>(
    '/:recordType',
    authMiddleware,
    validateBody(healthConnectSyncBodySchema),
    async (req, res) => {
      const { recordType } = req.params
      const { data } = req.body

      const records = Array.isArray(data) ? data : [data]
      const user = req.user!

      // Process each Health Connect record through the new schema
      for (const item of records) {
        await deps.processHealthConnectData(user, recordType, item)
      }

      // Trigger calorie computation when HR data is ingested
      if (recordType === 'HeartRateRecord' && records.length > 0) {
        const timestamps = records.flatMap((r) => {
          const samples = r.samples as Array<{ time: string }> | undefined
          if (samples) return samples.map((s) => new Date(s.time).getTime())
          const t = r.startTime || r.time
          return t ? [new Date(t as string).getTime()] : []
        })
        if (timestamps.length > 0) {
          const start = new Date(Math.min(...timestamps))
          const end = new Date(Math.max(...timestamps))
          await deps.triggerCalorieComputation(user, start, end)
        }
      }

      res.json({ success: true })
    },
  )

  return router
}
