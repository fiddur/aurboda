import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Mock pg-boss
const mockBossStart = vi.fn()
const mockBossStop = vi.fn()
const mockBossCreateQueue = vi.fn()
const mockBossSend = vi.fn()
const mockBossWork = vi.fn()
const mockBossOn = vi.fn()

vi.mock('pg-boss', () => ({
  PgBoss: vi.fn().mockImplementation(() => ({
    createQueue: mockBossCreateQueue,
    on: mockBossOn,
    send: mockBossSend,
    start: mockBossStart,
    stop: mockBossStop,
    work: mockBossWork,
  })),
}))

// Mock pg
const mockPgConnect = vi.fn()
const mockPgEnd = vi.fn()
const mockPgQuery = vi.fn()

vi.mock('pg', () => ({
  default: {
    Client: vi.fn().mockImplementation(() => ({
      connect: mockPgConnect,
      end: mockPgEnd,
      query: mockPgQuery,
    })),
  },
}))

// Mock geocoding
vi.mock('./geocoding', () => ({
  reverseGeocode: vi.fn().mockResolvedValue({
    data: { address: 'Test Address' },
    success: true,
  }),
}))

describe('createGeocodeQueue', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = {
      ...originalEnv,
      PGHOST: 'localhost',
      PGPASSWORD: 'testpass',
      PGPORT: '5432',
      PGUSER: 'testuser',
    }
    mockPgConnect.mockResolvedValue(undefined)
    mockPgEnd.mockResolvedValue(undefined)
    mockBossStart.mockResolvedValue(undefined)
    mockBossCreateQueue.mockResolvedValue(undefined)
    mockBossWork.mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test('returns null when PGUSER is not set', async () => {
    delete process.env.PGUSER

    const { createGeocodeQueue } = await import('./geocode-queue.js')
    const result = await createGeocodeQueue({
      updateDetectedLocation: vi.fn(),
    })

    expect(result).toBeNull()
  })

  test('returns null when PGPASSWORD is not set', async () => {
    delete process.env.PGPASSWORD

    const { createGeocodeQueue } = await import('./geocode-queue.js')
    const result = await createGeocodeQueue({
      updateDetectedLocation: vi.fn(),
    })

    expect(result).toBeNull()
  })

  test('creates queue and returns interface when credentials are set', async () => {
    vi.resetModules()

    const { createGeocodeQueue } = await import('./geocode-queue.js')
    const mockUpdateLocation = vi.fn()

    const queue = await createGeocodeQueue({
      updateDetectedLocation: mockUpdateLocation,
    })

    expect(queue).not.toBeNull()
    expect(queue!.getBoss).toBeDefined()
    expect(queue!.enqueueJob).toBeDefined()
    expect(queue!.enqueueJobs).toBeDefined()
    expect(queue!.stop).toBeDefined()
  })

  test('getBoss returns the boss instance', async () => {
    vi.resetModules()

    const { createGeocodeQueue } = await import('./geocode-queue.js')
    const queue = await createGeocodeQueue({
      updateDetectedLocation: vi.fn(),
    })

    expect(queue).not.toBeNull()
    const boss = queue!.getBoss()
    expect(boss).not.toBeNull()
  })

  test('stop calls boss.stop', async () => {
    vi.resetModules()
    mockBossStop.mockResolvedValue(undefined)

    const { createGeocodeQueue } = await import('./geocode-queue.js')
    const queue = await createGeocodeQueue({
      updateDetectedLocation: vi.fn(),
    })

    expect(queue).not.toBeNull()
    await queue!.stop()

    expect(mockBossStop).toHaveBeenCalled()
  })

  test('enqueueJob sends job to boss and updates location status', async () => {
    vi.resetModules()
    mockBossSend.mockResolvedValue('job-123')

    const mockUpdateLocation = vi.fn().mockResolvedValue({})
    const { createGeocodeQueue } = await import('./geocode-queue.js')
    const queue = await createGeocodeQueue({
      updateDetectedLocation: mockUpdateLocation,
    })

    expect(queue).not.toBeNull()
    const jobId = await queue!.enqueueJob({
      detectedLocationId: 'loc-1',
      lat: 59.3293,
      lon: 18.0686,
      user: 'testuser',
    })

    expect(jobId).toBe('job-123')
    expect(mockBossSend).toHaveBeenCalledWith(
      'geocode-location',
      {
        detectedLocationId: 'loc-1',
        lat: 59.3293,
        lon: 18.0686,
        user: 'testuser',
      },
      expect.objectContaining({
        retryLimit: 3,
      }),
    )
    expect(mockUpdateLocation).toHaveBeenCalledWith('testuser', 'loc-1', {
      geocodeStatus: 'geocoding',
    })
  })

  test('enqueueJob returns null on error', async () => {
    vi.resetModules()
    mockBossSend.mockRejectedValue(new Error('Queue error'))

    const mockUpdateLocation = vi.fn()
    const { createGeocodeQueue } = await import('./geocode-queue.js')
    const queue = await createGeocodeQueue({
      updateDetectedLocation: mockUpdateLocation,
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(queue).not.toBeNull()
    const jobId = await queue!.enqueueJob({
      detectedLocationId: 'loc-1',
      lat: 59.3293,
      lon: 18.0686,
      user: 'testuser',
    })

    expect(jobId).toBeNull()
    consoleSpy.mockRestore()
  })

  test('enqueueJobs enqueues multiple jobs', async () => {
    vi.resetModules()
    mockBossSend.mockResolvedValue('job-id')

    const mockUpdateLocation = vi.fn().mockResolvedValue({})
    const { createGeocodeQueue } = await import('./geocode-queue.js')
    const queue = await createGeocodeQueue({
      updateDetectedLocation: mockUpdateLocation,
    })

    expect(queue).not.toBeNull()
    await queue!.enqueueJobs('testuser', [
      { id: 'loc-1', lat: 59.3, lon: 18.0 },
      { id: 'loc-2', lat: 59.4, lon: 18.1 },
    ])

    expect(mockBossSend).toHaveBeenCalledTimes(2)
    expect(mockUpdateLocation).toHaveBeenCalledTimes(2)
  })
})
