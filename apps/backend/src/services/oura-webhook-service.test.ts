import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  createOuraWebhookService,
  DESIRED_SUBSCRIPTIONS_COUNT,
  type OuraWebhookServiceDeps,
} from './oura-webhook-service.ts'

describe('oura-webhook-service', () => {
  const createDeps = (): OuraWebhookServiceDeps => ({
    createSubscription: vi.fn().mockResolvedValue({
      callback_url: 'https://example.com/webhooks/oura',
      data_type: 'daily_sleep',
      event_type: 'create',
      expiration_time: '2026-03-15T00:00:00Z',
      id: 'new-sub-id',
    }),
    deleteLocalSubscription: vi.fn().mockResolvedValue(true),
    deleteRemoteSubscription: vi.fn().mockResolvedValue(undefined),
    getLocalSubscriptions: vi.fn().mockResolvedValue([]),
    listRemoteSubscriptions: vi.fn().mockResolvedValue([]),
    renewSubscription: vi.fn().mockResolvedValue({
      expiration_time: '2026-04-15T00:00:00Z',
      id: 'sub-1',
    }),
    upsertLocalSubscription: vi.fn().mockResolvedValue(undefined),
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('initSubscriptions', () => {
    test('creates all missing subscriptions when none exist remotely', async () => {
      const deps = createDeps()
      const service = createOuraWebhookService(deps)

      await service.initSubscriptions()

      // 6 data types * 2 event types = 12 subscriptions
      expect(deps.createSubscription).toHaveBeenCalledTimes(DESIRED_SUBSCRIPTIONS_COUNT)
      expect(deps.upsertLocalSubscription).toHaveBeenCalledTimes(DESIRED_SUBSCRIPTIONS_COUNT)
    })

    test('skips creation when subscriptions already exist remotely', async () => {
      const deps = createDeps()
      vi.mocked(deps.listRemoteSubscriptions).mockResolvedValue([
        {
          callback_url: 'https://example.com/webhooks/oura',
          data_type: 'daily_sleep',
          event_type: 'create',
          expiration_time: '2026-03-15T00:00:00Z',
          id: 'existing-sub',
          verification_token: 'token',
        },
      ])
      const service = createOuraWebhookService(deps)

      await service.initSubscriptions()

      // Should create 11 (12 - 1 existing)
      expect(deps.createSubscription).toHaveBeenCalledTimes(DESIRED_SUBSCRIPTIONS_COUNT - 1)
      // Should upsert the existing one + the 11 new ones
      expect(deps.upsertLocalSubscription).toHaveBeenCalledTimes(DESIRED_SUBSCRIPTIONS_COUNT)
    })

    test('handles API errors gracefully during creation', async () => {
      const deps = createDeps()
      vi.mocked(deps.createSubscription).mockRejectedValue(new Error('API error'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const service = createOuraWebhookService(deps)

      // Should not throw
      await service.initSubscriptions()

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('renewExpiringSubscriptions', () => {
    test('renews subscriptions expiring within 24 hours', async () => {
      const deps = createDeps()
      vi.mocked(deps.getLocalSubscriptions).mockResolvedValue([
        {
          callback_url: 'https://example.com/webhooks/oura',
          created_at: new Date('2026-02-01T00:00:00Z'),
          data_type: 'daily_sleep',
          event_type: 'create',
          // Expires in 12 hours — should be renewed
          expiration_time: new Date('2026-02-16T00:00:00Z'),
          oura_subscription_id: 'sub-1',
          updated_at: new Date('2026-02-01T00:00:00Z'),
        },
      ])
      const service = createOuraWebhookService(deps)

      await service.renewExpiringSubscriptions()

      expect(deps.renewSubscription).toHaveBeenCalledWith('sub-1')
      expect(deps.upsertLocalSubscription).toHaveBeenCalled()
    })

    test('skips subscriptions not expiring soon', async () => {
      const deps = createDeps()
      vi.mocked(deps.getLocalSubscriptions).mockResolvedValue([
        {
          callback_url: 'https://example.com/webhooks/oura',
          created_at: new Date('2026-02-01T00:00:00Z'),
          data_type: 'daily_sleep',
          event_type: 'create',
          // Expires in 7 days — should NOT be renewed
          expiration_time: new Date('2026-02-22T00:00:00Z'),
          oura_subscription_id: 'sub-1',
          updated_at: new Date('2026-02-01T00:00:00Z'),
        },
      ])
      const service = createOuraWebhookService(deps)

      await service.renewExpiringSubscriptions()

      expect(deps.renewSubscription).not.toHaveBeenCalled()
    })

    test('skips subscriptions with null expiration_time', async () => {
      const deps = createDeps()
      vi.mocked(deps.getLocalSubscriptions).mockResolvedValue([
        {
          callback_url: 'https://example.com/webhooks/oura',
          created_at: new Date('2026-02-01T00:00:00Z'),
          data_type: 'daily_sleep',
          event_type: 'create',
          expiration_time: null,
          oura_subscription_id: 'sub-1',
          updated_at: new Date('2026-02-01T00:00:00Z'),
        },
      ])
      const service = createOuraWebhookService(deps)

      await service.renewExpiringSubscriptions()

      expect(deps.renewSubscription).not.toHaveBeenCalled()
    })

    test('handles renewal errors gracefully', async () => {
      const deps = createDeps()
      vi.mocked(deps.getLocalSubscriptions).mockResolvedValue([
        {
          callback_url: 'https://example.com/webhooks/oura',
          created_at: new Date('2026-02-01T00:00:00Z'),
          data_type: 'daily_sleep',
          event_type: 'create',
          expiration_time: new Date('2026-02-16T00:00:00Z'),
          oura_subscription_id: 'sub-1',
          updated_at: new Date('2026-02-01T00:00:00Z'),
        },
      ])
      vi.mocked(deps.renewSubscription).mockRejectedValue(new Error('Renewal failed'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const service = createOuraWebhookService(deps)

      await service.renewExpiringSubscriptions()

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('startRenewalTimer / stopRenewalTimer', () => {
    test('starts and stops periodic renewal timer', () => {
      const deps = createDeps()
      const service = createOuraWebhookService(deps)

      service.startRenewalTimer()

      // Advance 12 hours
      vi.advanceTimersByTime(12 * 60 * 60 * 1000)

      expect(deps.getLocalSubscriptions).toHaveBeenCalled()

      service.stopRenewalTimer()

      vi.mocked(deps.getLocalSubscriptions).mockClear()
      vi.advanceTimersByTime(12 * 60 * 60 * 1000)

      // Should not have been called again after stopping
      expect(deps.getLocalSubscriptions).not.toHaveBeenCalled()
    })
  })
})
