/**
 * HTTP client for Oura webhook subscription management.
 *
 * Uses x-client-id / x-client-secret headers (app-level auth, not per-user OAuth).
 */

import axios from 'axios'
import type { OuraDataType } from './oura-sync'

const OURA_WEBHOOK_BASE = 'https://api.ouraring.com/v2/webhook/subscription'

/** Oura API data type identifiers used in webhook subscriptions */
export const OURA_DATA_TYPES = [
  'daily_cardiovascular_age',
  'daily_readiness',
  'daily_resilience',
  'daily_sleep',
  'session',
  'enhanced_tag',
] as const

export type OuraWebhookDataType = (typeof OURA_DATA_TYPES)[number]

export const OURA_EVENT_TYPES = ['create', 'update'] as const
export type OuraEventType = (typeof OURA_EVENT_TYPES)[number]

/** Map from Oura webhook data_type to our internal OuraDataType */
export const ouraWebhookDataTypeMap: Record<OuraWebhookDataType, OuraDataType> = {
  daily_cardiovascular_age: 'dailyCardiovascularAge',
  daily_readiness: 'dailyReadiness',
  daily_resilience: 'dailyResilience',
  daily_sleep: 'dailySleep',
  enhanced_tag: 'tags',
  session: 'sessions',
}

export interface OuraSubscriptionResponse {
  id: string
  callback_url: string
  data_type: string
  event_type: string
  expiration_time: string
  verification_token: string
}

export interface OuraRenewResponse {
  id: string
  expiration_time: string
}

export interface OuraWebhookApiDeps {
  clientId: string
  clientSecret: string
  callbackUrl: string
  verificationToken: string
}

export interface OuraWebhookApi {
  listSubscriptions: () => Promise<OuraSubscriptionResponse[]>
  createSubscription: (
    dataType: OuraWebhookDataType,
    eventType: OuraEventType,
  ) => Promise<OuraSubscriptionResponse>
  renewSubscription: (subscriptionId: string) => Promise<OuraRenewResponse>
  deleteSubscription: (subscriptionId: string) => Promise<void>
}

export const createOuraWebhookApi = (deps: OuraWebhookApiDeps): OuraWebhookApi => {
  const headers = {
    'x-client-id': deps.clientId,
    'x-client-secret': deps.clientSecret,
  }

  return {
    createSubscription: async (dataType, eventType) => {
      const response = await axios.post(
        OURA_WEBHOOK_BASE,
        {
          callback_url: deps.callbackUrl,
          data_type: dataType,
          event_type: eventType,
          verification_token: deps.verificationToken,
        },
        { headers },
      )
      return response.data
    },

    deleteSubscription: async (subscriptionId) => {
      await axios.delete(`${OURA_WEBHOOK_BASE}/${subscriptionId}`, { headers })
    },

    listSubscriptions: async () => {
      const response = await axios.get(OURA_WEBHOOK_BASE, { headers })
      return response.data
    },

    renewSubscription: async (subscriptionId) => {
      const response = await axios.put(`${OURA_WEBHOOK_BASE}/renew/${subscriptionId}`, undefined, { headers })
      return response.data
    },
  }
}
