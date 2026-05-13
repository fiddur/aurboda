/**
 * Express router for Strava webhook callback endpoint.
 *
 * Strava webhooks:
 * - GET: subscription validation (hub.challenge)
 * - POST: event notification (must respond < 2 seconds)
 *
 * One subscription per application covers all athletes.
 */

import { Router } from 'express'

import type { StravaWebhookEvent } from './types.ts'

import { auditInfo } from '../../services/audit-log.ts'
import { PRIORITY_WEBHOOK } from '../../services/strava-queue.ts'

export interface StravaWebhookRouterDeps {
  verifyToken: string
  getUsernameByStravaAthleteId: (stravaAthleteId: number) => Promise<string | null>
  enqueueActivityFetch: (user: string, activityId: number, priority: number) => Promise<void>
  softDeleteStravaActivity: (user: string, stravaActivityId: number) => Promise<void>
  handleDeauthorization: (stravaAthleteId: number) => Promise<void>
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
    // Respond immediately
    res.status(200).send('EVENT_RECEIVED')

    // Process asynchronously
    const event = req.body as StravaWebhookEvent
    handleEvent(event, deps).catch((error) => {
      console.error('Strava webhook event handler error:', error)
    })
  })

  return router
}

const handleEvent = async (event: StravaWebhookEvent, deps: StravaWebhookRouterDeps): Promise<void> => {
  if (event.object_type === 'activity') {
    const username = await deps.getUsernameByStravaAthleteId(event.owner_id)
    if (!username) return

    if (event.aspect_type === 'create' || event.aspect_type === 'update') {
      auditInfo(username, 'sync', `🏃 Strava webhook: ${event.aspect_type} activity ${event.object_id}`)
      await deps.enqueueActivityFetch(username, event.object_id, PRIORITY_WEBHOOK)
    } else if (event.aspect_type === 'delete') {
      auditInfo(username, 'sync', `🗑️ Strava webhook: delete activity ${event.object_id}`)
      await deps.softDeleteStravaActivity(username, event.object_id)
    }
  }

  if (event.object_type === 'athlete' && event.aspect_type === 'delete') {
    await deps.handleDeauthorization(event.owner_id)
  }
}
