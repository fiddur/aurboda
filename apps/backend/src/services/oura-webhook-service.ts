/**
 * Oura webhook subscription lifecycle management.
 *
 * Handles: initial subscription creation, periodic renewal, and cleanup.
 */

import { addHours, isBefore } from 'date-fns'
import {
  OURA_DATA_TYPES,
  OURA_EVENT_TYPES,
  type OuraEventType,
  type OuraRenewResponse,
  type OuraSubscriptionResponse,
  type OuraWebhookDataType,
} from '../oura-webhook-api'
import type { OuraWebhookSubscription } from './central-db'

const RENEWAL_INTERVAL_MS = 12 * 60 * 60 * 1000 // 12 hours
const RENEWAL_THRESHOLD_HOURS = 24

/** Total expected subscriptions: 6 data types * 2 event types */
export const DESIRED_SUBSCRIPTIONS_COUNT = OURA_DATA_TYPES.length * OURA_EVENT_TYPES.length

export interface OuraWebhookServiceDeps {
  listRemoteSubscriptions: () => Promise<OuraSubscriptionResponse[]>
  createSubscription: (
    dataType: OuraWebhookDataType,
    eventType: OuraEventType,
  ) => Promise<OuraSubscriptionResponse>
  renewSubscription: (subscriptionId: string) => Promise<OuraRenewResponse>
  deleteRemoteSubscription: (subscriptionId: string) => Promise<void>
  getLocalSubscriptions: () => Promise<OuraWebhookSubscription[]>
  upsertLocalSubscription: (sub: Omit<OuraWebhookSubscription, 'created_at' | 'updated_at'>) => Promise<void>
  deleteLocalSubscription: (ouraSubscriptionId: string) => Promise<boolean>
}

export interface OuraWebhookService {
  initSubscriptions: () => Promise<void>
  renewExpiringSubscriptions: () => Promise<void>
  startRenewalTimer: () => void
  stopRenewalTimer: () => void
}

export const createOuraWebhookService = (deps: OuraWebhookServiceDeps): OuraWebhookService => {
  let renewalTimer: NodeJS.Timeout | null = null

  const initSubscriptions = async (): Promise<void> => {
    console.log('Oura webhook: initializing subscriptions...')

    // Get existing remote subscriptions
    let remoteSubscriptions: OuraSubscriptionResponse[] = []
    try {
      remoteSubscriptions = await deps.listRemoteSubscriptions()
      console.log(`Oura webhook: found ${remoteSubscriptions.length} existing remote subscriptions`)
    } catch (error) {
      console.error('Oura webhook: failed to list remote subscriptions:', error)
    }

    // Build set of existing (data_type, event_type) pairs
    const existingPairs = new Set(remoteSubscriptions.map((s) => `${s.data_type}:${s.event_type}`))

    // Upsert existing subscriptions to local DB
    for (const sub of remoteSubscriptions) {
      await deps.upsertLocalSubscription({
        callback_url: sub.callback_url,
        data_type: sub.data_type,
        event_type: sub.event_type,
        expiration_time: sub.expiration_time ? new Date(sub.expiration_time) : null,
        oura_subscription_id: sub.id,
      })
    }

    // Create missing subscriptions
    for (const dataType of OURA_DATA_TYPES) {
      for (const eventType of OURA_EVENT_TYPES) {
        const key = `${dataType}:${eventType}`
        if (existingPairs.has(key)) continue

        try {
          const created = await deps.createSubscription(dataType, eventType)
          await deps.upsertLocalSubscription({
            callback_url: created.callback_url,
            data_type: created.data_type,
            event_type: created.event_type,
            expiration_time: created.expiration_time ? new Date(created.expiration_time) : null,
            oura_subscription_id: created.id,
          })
          console.log(`Oura webhook: created subscription for ${dataType}/${eventType} (id=${created.id})`)
        } catch (error) {
          console.error(`Oura webhook: failed to create subscription for ${dataType}/${eventType}:`, error)
        }
      }
    }

    console.log('Oura webhook: subscription initialization complete')
  }

  const renewExpiringSubscriptions = async (): Promise<void> => {
    const localSubscriptions = await deps.getLocalSubscriptions()
    const renewalThreshold = addHours(new Date(), RENEWAL_THRESHOLD_HOURS)

    for (const sub of localSubscriptions) {
      if (!sub.expiration_time) continue
      if (!isBefore(sub.expiration_time, renewalThreshold)) continue

      try {
        const renewed = await deps.renewSubscription(sub.oura_subscription_id)
        await deps.upsertLocalSubscription({
          ...sub,
          expiration_time: renewed.expiration_time ? new Date(renewed.expiration_time) : null,
        })
        console.log(`Oura webhook: renewed subscription ${sub.oura_subscription_id}`)
      } catch (error) {
        console.error(`Oura webhook: failed to renew subscription ${sub.oura_subscription_id}:`, error)
      }
    }
  }

  const startRenewalTimer = (): void => {
    if (renewalTimer) return
    renewalTimer = setInterval(() => {
      renewExpiringSubscriptions().catch((error) => {
        console.error('Oura webhook: renewal timer error:', error)
      })
    }, RENEWAL_INTERVAL_MS)
    console.log('Oura webhook: renewal timer started (every 12h)')
  }

  const stopRenewalTimer = (): void => {
    if (renewalTimer) {
      clearInterval(renewalTimer)
      renewalTimer = null
      console.log('Oura webhook: renewal timer stopped')
    }
  }

  return {
    initSubscriptions,
    renewExpiringSubscriptions,
    startRenewalTimer,
    stopRenewalTimer,
  }
}
