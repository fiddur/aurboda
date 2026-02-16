/**
 * Correlations route group.
 *
 * Handles: /correlations/*
 */
import {
  type ActivityImpactQuery,
  activityImpactQuerySchema,
  type ActivityImpactResponse,
  type BaselineQuery,
  baselineQuerySchema,
  type BaselineResponse,
  type EventProbabilityBody,
  eventProbabilityBodySchema,
  type EventProbabilityResponse,
  type GenericCorrelationBody,
  genericCorrelationBodySchema,
  type GenericCorrelationResponse,
  type HrvActivitiesQuery,
  hrvActivitiesQuerySchema,
  type HrvActivitiesResponse,
} from '@aurboda/api-spec'
import { RequestHandler, Router } from 'express'
import {
  getActivityImpact,
  getBaseline,
  getEventProbability,
  getGenericCorrelation,
  getHrvActivitiesCorrelation,
} from '../services/correlations'
import { type SyncProvider } from '../services/queries'
import { validateBody, validateQuery } from '../validation'

export const createCorrelationsRouter = (
  authMiddleware: RequestHandler,
  syncProvider?: SyncProvider,
): Router => {
  const router = Router()

  // GET /correlations/baseline - Get HRV baseline statistics
  router.get<Record<string, never>, BaselineResponse, unknown, BaselineQuery>(
    '/baseline',
    authMiddleware,
    validateQuery(baselineQuerySchema),
    async (req, res) => {
      const { reference_date } = req.query
      const user = req.user!

      const referenceDate = reference_date ? new Date(reference_date) : undefined
      const baseline = await getBaseline(user, referenceDate)
      res.json({ data: baseline, success: true })
    },
  )

  // GET /correlations/hrv-activities - Get HRV correlations with activities
  router.get<Record<string, never>, HrvActivitiesResponse, unknown, HrvActivitiesQuery>(
    '/hrv-activities',
    authMiddleware,
    validateQuery(hrvActivitiesQuerySchema),
    async (req, res) => {
      const { period_days } = req.query
      const user = req.user!

      const periodDays = period_days ? parseInt(period_days, 10) : 30
      const correlations = await getHrvActivitiesCorrelation(user, periodDays, syncProvider)
      res.json({ data: correlations, success: true })
    },
  )

  // GET /correlations/activity-impact/:activity - Get activity impact on metrics
  router.get<{ activity: string }, ActivityImpactResponse, unknown, ActivityImpactQuery>(
    '/activity-impact/:activity',
    authMiddleware,
    validateQuery(activityImpactQuerySchema),
    async (req, res) => {
      const { activity } = req.params
      const { activity_type, period_days, window_minutes } = req.query
      const user = req.user!

      const periodDays = period_days ? parseInt(period_days, 10) : 90
      const windowMinutes = window_minutes ? parseInt(window_minutes, 10) : 30

      const impact = await getActivityImpact(
        user,
        activity,
        activity_type,
        windowMinutes,
        periodDays,
        syncProvider,
      )
      res.json({ data: impact, success: true })
    },
  )

  // POST /correlations/event-probability - Get event probability correlation
  router.post<Record<string, never>, EventProbabilityResponse, EventProbabilityBody>(
    '/event-probability',
    authMiddleware,
    validateBody(eventProbabilityBodySchema),
    async (req, res) => {
      const { trigger_type, trigger_value, outcome_pattern, lag_windows, period_days } = req.body
      const user = req.user!

      const probability = await getEventProbability(
        user,
        { type: trigger_type, value: trigger_value },
        { pattern: outcome_pattern, type: 'tag' },
        lag_windows ?? ['12h', '24h', '36h', '48h'],
        period_days ?? 365,
        syncProvider,
      )
      res.json({ data: probability, success: true })
    },
  )

  // POST /correlations/generic - Generic correlation analysis
  router.post<Record<string, never>, GenericCorrelationResponse, GenericCorrelationBody>(
    '/generic',
    authMiddleware,
    validateBody(genericCorrelationBodySchema),
    async (req, res) => {
      const { triggers, outcome, lag_windows, period_days } = req.body
      const user = req.user!

      const result = await getGenericCorrelation(
        user,
        triggers,
        outcome,
        lag_windows ?? ['24h', '48h', '7d'],
        period_days ?? 90,
        syncProvider,
      )
      res.json({ data: result, success: true })
    },
  )

  return router
}
