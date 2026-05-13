/**
 * Strava webhook subscription lifecycle manager.
 *
 * Strava allows exactly one webhook subscription per application.
 * This manager handles creating and verifying the subscription.
 */

import axios, { isAxiosError } from 'axios'

const STRAVA_SUBSCRIPTIONS_URL = 'https://www.strava.com/api/v3/push_subscriptions'

export interface StravaWebhookManagerDeps {
  clientId: string
  clientSecret: string
  callbackUrl: string
  verifyToken: string
}

export interface StravaWebhookSubscription {
  id: number
  callback_url: string
  created_at: string
  updated_at: string
}

export const createStravaWebhookManager = (deps: StravaWebhookManagerDeps) => {
  return {
    /**
     * Get the current subscription (if any).
     */
    async getSubscription(): Promise<StravaWebhookSubscription | null> {
      try {
        const response = await axios.get<StravaWebhookSubscription[]>(STRAVA_SUBSCRIPTIONS_URL, {
          params: {
            client_id: deps.clientId,
            client_secret: deps.clientSecret,
          },
        })
        return response.data.length > 0 ? response.data[0] : null
      } catch {
        return null
      }
    },

    /**
     * Create a webhook subscription.
     * Strava will send a GET to callbackUrl with hub.challenge to verify.
     */
    async createSubscription(): Promise<StravaWebhookSubscription> {
      const response = await axios.post<StravaWebhookSubscription>(STRAVA_SUBSCRIPTIONS_URL, {
        callback_url: deps.callbackUrl,
        client_id: deps.clientId,
        client_secret: deps.clientSecret,
        verify_token: deps.verifyToken,
      })
      return response.data
    },

    /**
     * Delete an existing subscription.
     */
    async deleteSubscription(subscriptionId: number): Promise<void> {
      await axios.delete(`${STRAVA_SUBSCRIPTIONS_URL}/${subscriptionId}`, {
        params: {
          client_id: deps.clientId,
          client_secret: deps.clientSecret,
        },
      })
    },

    /**
     * Ensure a subscription exists, creating one if needed.
     */
    async ensureSubscription(): Promise<void> {
      const existing = await this.getSubscription()
      if (existing) {
        if (existing.callback_url === deps.callbackUrl) {
          console.info(`🏃 Strava webhook subscription already exists (${existing.callback_url})`)
          return
        }
        console.info(
          `🏃 Strava webhook URL changed: ${existing.callback_url} → ${deps.callbackUrl}, recreating`,
        )
        await this.deleteSubscription(existing.id)
      }

      try {
        await this.createSubscription()
        console.info('🏃 Strava webhook subscription created')
      } catch (error) {
        const detail =
          isAxiosError(error) && error.response?.data
            ? JSON.stringify(error.response.data)
            : error instanceof Error
              ? error.message
              : String(error)
        console.warn('⚠️ Failed to create Strava webhook subscription:', detail)
      }
    },
  }
}
