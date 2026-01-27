import { RequestHandler, Router } from 'express'
import { DailyAggregate } from './db'

/**
 * Dependencies for sync router - allows testing with mocks
 */
export interface SyncRouterDeps {
  processDailyAggregate: (user: string, aggregate: DailyAggregate) => Promise<void>
  processHealthConnectData: (user: string, recordType: string, data: Record<string, unknown>) => Promise<void>
  syncOura: (user: string, options: { fullResync?: boolean; startDate?: Date }) => Promise<unknown>
  getOuraSyncStates: (user: string) => Promise<unknown[]>
  resetOuraSyncState: (user: string, dataType?: string) => Promise<void>
  syncRescueTime: (
    user: string,
    apiKey: string,
    options: { fullResync?: boolean; startDate?: Date },
  ) => Promise<unknown>
  getRescueTimeSyncStates: (user: string) => Promise<unknown[]>
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
  router.post('/daily-aggregates', authMiddleware, async (req, res) => {
    const { data } = req.body as { data?: DailyAggregate[] }
    const user = req.user!

    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.json({ success: true })
    }

    for (const aggregate of data) {
      await deps.processDailyAggregate(user, aggregate)
    }

    res.json({ success: true })
  })

  // Oura sync endpoints
  router.post('/oura', authMiddleware, async (req, res) => {
    const user = req.user!
    const { fullResync, startDate } = req.body as { fullResync?: boolean; startDate?: string }

    try {
      const results = await deps.syncOura(user, {
        fullResync,
        startDate: startDate ? new Date(startDate) : undefined,
      })

      res.json({ results, success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  router.get('/oura/status', authMiddleware, async (req, res) => {
    const user = req.user!

    try {
      const states = await deps.getOuraSyncStates(user)
      res.json({ states, success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  router.delete('/oura/state', authMiddleware, async (req, res) => {
    const user = req.user!
    const { dataType } = req.query as { dataType?: string }

    try {
      await deps.resetOuraSyncState(user, dataType)
      res.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  // RescueTime sync endpoints
  router.post('/rescuetime', authMiddleware, async (req, res) => {
    const user = req.user!
    const { fullResync, startDate } = req.body as { fullResync?: boolean; startDate?: string }
    const settings = await deps.getSettings(user)
    const rescueTimeKey = settings.rescueTimeKey

    if (!rescueTimeKey) {
      return res
        .status(400)
        .json({ error: 'RescueTime API key not configured in user settings', success: false })
    }

    try {
      const result = await deps.syncRescueTime(user, rescueTimeKey, {
        fullResync,
        startDate: startDate ? new Date(startDate) : undefined,
      })

      res.json({ result, success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  router.get('/rescuetime/status', authMiddleware, async (req, res) => {
    const user = req.user!

    try {
      const states = await deps.getRescueTimeSyncStates(user)
      res.json({ states, success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(500).json({ error: message, success: false })
    }
  })

  router.delete('/rescuetime/state', authMiddleware, async (req, res) => {
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
  router.post<{ recordType: string }, { success: boolean }>(
    '/:recordType',
    authMiddleware,
    async (req, res) => {
      const { recordType } = req.params
      let { data } = req.body

      if (!Array.isArray(data) && typeof data === 'object' && Object.entries(data).length) {
        data = [data]
      }

      if (!data?.length) {
        console.log('  empty?!')
        return res.json({ success: true })
      }

      const user = req.user!

      // Process each Health Connect record through the new schema
      for (const item of data) {
        await deps.processHealthConnectData(user, recordType, item)
      }

      res.json({ success: true })
    },
  )

  return router
}
