import axios from 'axios'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  createOuraWebhookApi,
  OURA_DATA_TYPES,
  OURA_EVENT_TYPES,
  type OuraWebhookApiDeps,
} from './webhook-api.ts'

vi.mock('axios')
const mockedAxios = vi.mocked(axios)

describe('oura-webhook-api', () => {
  const createDeps = (): OuraWebhookApiDeps => ({
    callbackUrl: 'https://example.com/webhooks/oura',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    verificationToken: 'test-verification-token',
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listSubscriptions', () => {
    test('returns list of subscriptions from Oura API', async () => {
      const subscriptions = [
        {
          callback_url: 'https://example.com/webhooks/oura',
          data_type: 'daily_sleep',
          event_type: 'create',
          expiration_time: '2026-03-01T00:00:00Z',
          id: 'sub-1',
          verification_token: 'test-verification-token',
        },
      ]
      mockedAxios.get = vi.fn().mockResolvedValue({ data: subscriptions })

      const api = createOuraWebhookApi(createDeps())
      const result = await api.listSubscriptions()

      expect(result).toEqual(subscriptions)
      expect(mockedAxios.get).toHaveBeenCalledWith('https://api.ouraring.com/v2/webhook/subscription', {
        headers: {
          'x-client-id': 'test-client-id',
          'x-client-secret': 'test-client-secret',
        },
      })
    })
  })

  describe('createSubscription', () => {
    test('creates a subscription via Oura API', async () => {
      const responseData = {
        callback_url: 'https://example.com/webhooks/oura',
        data_type: 'daily_sleep',
        event_type: 'create',
        expiration_time: '2026-03-01T00:00:00Z',
        id: 'sub-new',
        verification_token: 'test-verification-token',
      }
      mockedAxios.post = vi.fn().mockResolvedValue({ data: responseData })

      const api = createOuraWebhookApi(createDeps())
      const result = await api.createSubscription('daily_sleep', 'create')

      expect(result).toEqual(responseData)
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.ouraring.com/v2/webhook/subscription',
        {
          callback_url: 'https://example.com/webhooks/oura',
          data_type: 'daily_sleep',
          event_type: 'create',
          verification_token: 'test-verification-token',
        },
        {
          headers: {
            'x-client-id': 'test-client-id',
            'x-client-secret': 'test-client-secret',
          },
        },
      )
    })
  })

  describe('renewSubscription', () => {
    test('renews a subscription via Oura API', async () => {
      const responseData = {
        expiration_time: '2026-04-01T00:00:00Z',
        id: 'sub-1',
      }
      mockedAxios.put = vi.fn().mockResolvedValue({ data: responseData })

      const api = createOuraWebhookApi(createDeps())
      const result = await api.renewSubscription('sub-1')

      expect(result).toEqual(responseData)
      expect(mockedAxios.put).toHaveBeenCalledWith(
        'https://api.ouraring.com/v2/webhook/subscription/renew/sub-1',
        undefined,
        {
          headers: {
            'x-client-id': 'test-client-id',
            'x-client-secret': 'test-client-secret',
          },
        },
      )
    })
  })

  describe('deleteSubscription', () => {
    test('deletes a subscription via Oura API', async () => {
      mockedAxios.delete = vi.fn().mockResolvedValue({ status: 204 })

      const api = createOuraWebhookApi(createDeps())
      await api.deleteSubscription('sub-1')

      expect(mockedAxios.delete).toHaveBeenCalledWith(
        'https://api.ouraring.com/v2/webhook/subscription/sub-1',
        {
          headers: {
            'x-client-id': 'test-client-id',
            'x-client-secret': 'test-client-secret',
          },
        },
      )
    })
  })

  describe('constants', () => {
    test('OURA_DATA_TYPES contains all expected types', () => {
      expect(OURA_DATA_TYPES).toEqual([
        'daily_cardiovascular_age',
        'daily_readiness',
        'daily_resilience',
        'daily_sleep',
        'session',
        'sleep',
        'enhanced_tag',
      ])
    })

    test('OURA_EVENT_TYPES contains create and update', () => {
      expect(OURA_EVENT_TYPES).toEqual(['create', 'update'])
    })
  })
})
