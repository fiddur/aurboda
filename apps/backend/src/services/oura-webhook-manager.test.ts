import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createOuraWebhookManager, type OuraWebhookManagerDeps } from './oura-webhook-manager'

describe('oura-webhook-manager', () => {
  const createDeps = (): OuraWebhookManagerDeps => ({
    centralDb: {
      deleteAllOuraWebhookSubscriptions: vi.fn().mockResolvedValue(0),
      deleteOuraWebhookSubscription: vi.fn().mockResolvedValue(true),
      getOuraWebhookSubscriptions: vi.fn().mockResolvedValue([]),
      getServerSetting: vi.fn().mockResolvedValue('existing-verification-token'),
      getUsernameByOuraUserId: vi.fn().mockResolvedValue('testuser'),
      setServerSetting: vi.fn().mockResolvedValue(undefined),
      upsertOuraWebhookSubscription: vi.fn().mockResolvedValue(undefined),
    },
    ouraClientId: 'test-client-id',
    ouraClientSecret: 'test-client-secret',
    syncOuraDataTypeForUser: vi.fn().mockResolvedValue(undefined),
  })

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('enable', () => {
    test('creates router and service, initializes subscriptions', async () => {
      const deps = createDeps()
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const manager = createOuraWebhookManager(deps)

      await manager.enable('https://example.com/webhooks/oura')

      expect(manager.isEnabled()).toBe(true)
      consoleSpy.mockRestore()
    })

    test('uses existing verification token from central DB', async () => {
      const deps = createDeps()
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const manager = createOuraWebhookManager(deps)

      await manager.enable('https://example.com/webhooks/oura')

      expect(deps.centralDb.getServerSetting).toHaveBeenCalledWith('oura_webhook_verification_token')
      // Should NOT generate a new token since one exists
      expect(deps.centralDb.setServerSetting).not.toHaveBeenCalledWith(
        'oura_webhook_verification_token',
        expect.any(String),
      )
      consoleSpy.mockRestore()
    })

    test('generates verification token when none exists', async () => {
      const deps = createDeps()
      vi.mocked(deps.centralDb.getServerSetting).mockResolvedValue(null)
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const manager = createOuraWebhookManager(deps)

      await manager.enable('https://example.com/webhooks/oura')

      expect(deps.centralDb.setServerSetting).toHaveBeenCalledWith(
        'oura_webhook_verification_token',
        expect.any(String),
      )
      consoleSpy.mockRestore()
    })
  })

  describe('disable', () => {
    test('clears subscriptions and stops renewal', async () => {
      const deps = createDeps()
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const manager = createOuraWebhookManager(deps)

      await manager.enable('https://example.com/webhooks/oura')
      expect(manager.isEnabled()).toBe(true)

      await manager.disable()
      expect(manager.isEnabled()).toBe(false)

      expect(deps.centralDb.deleteAllOuraWebhookSubscriptions).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    test('is a no-op when already disabled', async () => {
      const deps = createDeps()
      const manager = createOuraWebhookManager(deps)

      await manager.disable()
      expect(manager.isEnabled()).toBe(false)
    })
  })

  describe('handleWebhookRequest', () => {
    test('returns 404 when disabled', () => {
      const deps = createDeps()
      const manager = createOuraWebhookManager(deps)

      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      }

      manager.handleWebhookRequest({} as never, mockRes as never, vi.fn())

      expect(mockRes.status).toHaveBeenCalledWith(404)
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Oura webhook not enabled' })
    })
  })

  describe('shutdown', () => {
    test('clears pending syncs and stops timer without remote unregister', async () => {
      const deps = createDeps()
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const manager = createOuraWebhookManager(deps)

      await manager.enable('https://example.com/webhooks/oura')
      manager.shutdown()

      expect(manager.isEnabled()).toBe(false)
      // Should NOT have tried to delete remote subscriptions
      expect(deps.centralDb.deleteAllOuraWebhookSubscriptions).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })
})
