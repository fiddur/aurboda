/**
 * Strava webhooks:
 * - GET: subscription validation (hub.challenge)
 * - POST: event notification (must respond < 2 seconds)
 *
 * One subscription per application covers all athletes.
 */

import { json, type RequestHandler, Router } from 'express'

import type { StravaWebhookEvent } from './types.ts'

import { auditInfo } from '../../services/audit-log.ts'
import { PRIORITY_WEBHOOK } from '../../services/strava-queue.ts'
import { losslessIntegerReviver, toStravaId } from './ids.ts'

/** Webhook events carry ids only as JSON numbers, so they are parsed without rounding. */
export const stravaWebhookBodyParser = (): RequestHandler => json({ reviver: losslessIntegerReviver })

export interface StravaWebhookRouterDeps {
  verifyToken: string
  getUsernameByStravaAthleteId: (stravaAthleteId: string) => Promise<string | null>
  enqueueActivityFetch: (user: string, activityId: string, priority: number) => Promise<void>
  softDeleteStravaActivity: (user: string, stravaActivityId: string) => Promise<void>
  handleDeauthorization: (stravaAthleteId: string) => Promise<void>
}

export const createStravaWebhookRouter = (deps: StravaWebhookRouterDeps): Router => {
  const router = Router()

  // Subscription validation — Strava sends a GET with hub.challenge
  router.get('/', (req, res) => {
    const mode = req.query['hub.mode'] as string | undefined
    const challenge = req.query['hub.challenge'] as string | undefined
    const verifyToken = req.query['hub.verify_token'] as string | undefined

    if (mode === 'subscribe' && verifyToken === deps.verifyToken) {
      res.json({ 'hub.challenge': challenge })
    } else {
      res.status(403).json({ error: 'Invalid verification' })
    }
  })

  // Event handler — must respond immediately (< 2 seconds)
  router.post('/', (req, res) => {
    res.status(200).send('EVENT_RECEIVED')

    const event = req.body as StravaWebhookEvent
    handleEvent(event, deps).catch((error) => {
      console.error('Strava webhook event handler error:', error)
    })
  })

  return router
}

const handleEvent = async (event: StravaWebhookEvent, deps: StravaWebhookRouterDeps): Promise<void> => {
  const ownerId = toStravaId(event.owner_id)
  if (!ownerId) return

  if (event.object_type === 'activity') {
    const activityId = toStravaId(event.object_id)
    if (!activityId) return

    const username = await deps.getUsernameByStravaAthleteId(ownerId)
    if (!username) return

    if (event.aspect_type === 'create' || event.aspect_type === 'update') {
      auditInfo(username, 'sync', `🏃 Strava webhook: ${event.aspect_type} activity ${activityId}`)
      await deps.enqueueActivityFetch(username, activityId, PRIORITY_WEBHOOK)
    } else if (event.aspect_type === 'delete') {
      auditInfo(username, 'sync', `🗑️ Strava webhook: delete activity ${activityId}`)
      await deps.softDeleteStravaActivity(username, activityId)
    }
  }

  if (event.object_type === 'athlete' && event.aspect_type === 'delete') {
    await deps.handleDeauthorization(ownerId)
  }
}
