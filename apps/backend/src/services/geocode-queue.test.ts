import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Mock audit-log (imported by geocode-queue)
vi.mock('./audit-log', () => ({
  auditError: vi.fn(),
  auditInfo: vi.fn(),
  auditWarn: vi.fn(),
}))

// Mock geocoding
vi.mock('./geocoding', () => ({
  reverseGeocode: vi.fn().mockResolvedValue({
    data: { address: 'Test Address' },
    success: true,
  }),
}))

import { createGeocodeQueue } from './geocode-queue.ts'

const createMockBoss = () => ({
  createQueue: vi.fn().mockResolvedValue(undefined),
  send: vi.fn().mockResolvedValue('job-123'),
  work: vi.fn().mockResolvedValue(undefined),
})

describe('createGeocodeQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('creates queue and registers worker', async () => {
    const boss = createMockBoss()

    const queue = await createGeocodeQueue(boss as never, {
      updateDetectedLocation: vi.fn(),
    })

    expect(queue).not.toBeNull()
    expect(queue.enqueueJob).toBeDefined()
    expect(queue.enqueueJobs).toBeDefined()
    expect(boss.createQueue).toHaveBeenCalledWith('geocode-location')
    expect(boss.work).toHaveBeenCalledWith(
      'geocode-location',
      { batchSize: 1, pollingIntervalSeconds: 2 },
      expect.any(Function),
    )
  })

  test('enqueueJob sends job to boss and updates location status', async () => {
    const boss = createMockBoss()
    const mockUpdateLocation = vi.fn().mockResolvedValue({})

    const queue = await createGeocodeQueue(boss as never, {
      updateDetectedLocation: mockUpdateLocation,
    })

    const jobId = await queue.enqueueJob({
      detectedLocationId: 'loc-1',
      lat: 59.3293,
      lon: 18.0686,
      user: 'testuser',
    })

    expect(jobId).toBe('job-123')
    expect(boss.send).toHaveBeenCalledWith(
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
      geocode_status: 'geocoding',
    })
  })

  test('enqueueJob returns null on error', async () => {
    const boss = createMockBoss()
    boss.send.mockRejectedValue(new Error('Queue error'))

    const queue = await createGeocodeQueue(boss as never, {
      updateDetectedLocation: vi.fn(),
    })

    const jobId = await queue.enqueueJob({
      detectedLocationId: 'loc-1',
      lat: 59.3293,
      lon: 18.0686,
      user: 'testuser',
    })

    expect(jobId).toBeNull()
  })

  test('enqueueJobs enqueues multiple jobs', async () => {
    const boss = createMockBoss()
    const mockUpdateLocation = vi.fn().mockResolvedValue({})

    const queue = await createGeocodeQueue(boss as never, {
      updateDetectedLocation: mockUpdateLocation,
    })

    await queue.enqueueJobs('testuser', [
      { id: 'loc-1', lat: 59.3, lon: 18.0 },
      { id: 'loc-2', lat: 59.4, lon: 18.1 },
    ])

    expect(boss.send).toHaveBeenCalledTimes(2)
    expect(mockUpdateLocation).toHaveBeenCalledTimes(2)
  })
})
