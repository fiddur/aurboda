import {
  dailyAggregatesBodySchema,
  healthConnectSyncBodySchema,
  syncOuraBodySchema,
  syncRescueTimeBodySchema,
  type DailyAggregate,
  type DailyAggregatesBody,
  type HealthConnectRecord,
  type HealthConnectSyncBody,
  type OuraSyncResponse,
  type OuraSyncResult,
  type OuraSyncStatusResponse,
  type ProviderSyncStatus,
  type RescueTimeSyncResponse,
  type RescueTimeSyncResult,
  type RescueTimeSyncStatusResponse,
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
export interface SyncRouterDeps {
  processDailyAggregate: (user: string, aggregate: DailyAggregate) => Promise<void>
  processHealthConnectData: (user: string, recordType: string, data: HealthConnectRecord) => Promise<void>
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
  getSettings: (user: string) => Promise<{ rescueTimeKey?: string }>
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
      const rescueTimeKey = settings.rescueTimeKey

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

      res.json({ success: true })
    },
  )

  return router
}
