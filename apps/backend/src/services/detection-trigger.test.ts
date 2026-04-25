import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Mock audit log to avoid DB connections in unit tests
vi.mock('./audit-log.ts', () => ({
  auditError: vi.fn(),
  auditInfo: vi.fn(),
  auditWarn: vi.fn(),
}))

import { createDetectionTrigger, type DetectionTriggerDeps } from './detection-trigger.ts'

describe('createDetectionTrigger', () => {
  const createMockDeps = (): DetectionTriggerDeps => ({
    geocodeQueue: {
      enqueueJob: vi.fn().mockResolvedValue('job-id'),
      enqueueJobs: vi.fn(),
    },
    getDetectedLocationById: vi.fn().mockResolvedValue({
      id: 'loc-1',
      lat: 59.3293,
      lon: 18.0686,
    }),
    getNamedLocations: vi.fn().mockResolvedValue([]),
    getPlaceVisits: vi.fn().mockResolvedValue([]),
    insertActivities: vi.fn().mockResolvedValue(undefined),
    runDetectionForUser: vi.fn().mockResolvedValue({
      created: 1,
      needsGeocode: ['loc-1'],
      updated: 0,
    }),
  })

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  test('triggerDetectionForUser schedules detection after debounce', async () => {
    const deps = createMockDeps()
    const trigger = createDetectionTrigger(deps)

    trigger.triggerDetectionForUser('testuser')

    // Detection should not run immediately
    expect(deps.runDetectionForUser).not.toHaveBeenCalled()

    // Advance timers by 5 seconds
    await vi.advanceTimersByTimeAsync(5000)

    expect(deps.runDetectionForUser).toHaveBeenCalledWith('testuser')
  })

  test('multiple triggers within debounce window only run detection once', async () => {
    const deps = createMockDeps()
    const trigger = createDetectionTrigger(deps)

    trigger.triggerDetectionForUser('testuser')
    await vi.advanceTimersByTimeAsync(2000)
    trigger.triggerDetectionForUser('testuser')
    await vi.advanceTimersByTimeAsync(2000)
    trigger.triggerDetectionForUser('testuser')

    // Only 4 seconds since last trigger, detection shouldn't have run yet
    expect(deps.runDetectionForUser).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5000)

    // Should only run once despite multiple triggers
    expect(deps.runDetectionForUser).toHaveBeenCalledTimes(1)
  })

  test('different users have independent debounce', async () => {
    const deps = createMockDeps()
    const trigger = createDetectionTrigger(deps)

    trigger.triggerDetectionForUser('user1')
    trigger.triggerDetectionForUser('user2')

    await vi.advanceTimersByTimeAsync(5000)

    expect(deps.runDetectionForUser).toHaveBeenCalledTimes(2)
    expect(deps.runDetectionForUser).toHaveBeenCalledWith('user1')
    expect(deps.runDetectionForUser).toHaveBeenCalledWith('user2')
  })

  test('enqueues geocode jobs when locations need geocoding', async () => {
    const deps = createMockDeps()
    const trigger = createDetectionTrigger(deps)

    trigger.triggerDetectionForUser('testuser')
    await vi.advanceTimersByTimeAsync(5000)

    expect(deps.getDetectedLocationById).toHaveBeenCalledWith('testuser', 'loc-1')
    expect(deps.geocodeQueue!.enqueueJob).toHaveBeenCalledWith({
      detectedLocationId: 'loc-1',
      lat: 59.3293,
      lon: 18.0686,
      user: 'testuser',
    })
  })

  test('skips geocoding when queue is null', async () => {
    const deps = createMockDeps()
    deps.geocodeQueue = null
    const trigger = createDetectionTrigger(deps)

    trigger.triggerDetectionForUser('testuser')
    await vi.advanceTimersByTimeAsync(5000)

    expect(deps.runDetectionForUser).toHaveBeenCalled()
    expect(deps.getDetectedLocationById).not.toHaveBeenCalled()
  })

  test('skips enqueueing when getDetectedLocationById returns null', async () => {
    const deps = createMockDeps()
    vi.mocked(deps.getDetectedLocationById).mockResolvedValue(null)
    const trigger = createDetectionTrigger(deps)

    trigger.triggerDetectionForUser('testuser')
    await vi.advanceTimersByTimeAsync(5000)

    expect(deps.runDetectionForUser).toHaveBeenCalled()
    expect(deps.getDetectedLocationById).toHaveBeenCalledWith('testuser', 'loc-1')
    // Should not enqueue job when location is not found
    expect(deps.geocodeQueue!.enqueueJob).not.toHaveBeenCalled()
  })

  test('clearPendingDetections cancels scheduled detections', async () => {
    const deps = createMockDeps()
    const trigger = createDetectionTrigger(deps)

    trigger.triggerDetectionForUser('testuser')
    expect(trigger.getPendingDetectionCount()).toBe(1)

    trigger.clearPendingDetections()
    expect(trigger.getPendingDetectionCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(5000)

    // Detection should not have run
    expect(deps.runDetectionForUser).not.toHaveBeenCalled()
  })

  test('getPendingDetectionCount returns correct count', () => {
    const deps = createMockDeps()
    const trigger = createDetectionTrigger(deps)

    expect(trigger.getPendingDetectionCount()).toBe(0)

    trigger.triggerDetectionForUser('user1')
    expect(trigger.getPendingDetectionCount()).toBe(1)

    trigger.triggerDetectionForUser('user2')
    expect(trigger.getPendingDetectionCount()).toBe(2)

    trigger.triggerDetectionForUser('user1') // Re-trigger, should not increase count
    expect(trigger.getPendingDetectionCount()).toBe(2)
  })

  test('hasPendingDetection returns correct status', () => {
    const deps = createMockDeps()
    const trigger = createDetectionTrigger(deps)

    expect(trigger.hasPendingDetection('user1')).toBe(false)

    trigger.triggerDetectionForUser('user1')
    expect(trigger.hasPendingDetection('user1')).toBe(true)
    expect(trigger.hasPendingDetection('user2')).toBe(false)
  })

  test('handles detection errors gracefully', async () => {
    const { auditError } = await import('./audit-log.ts')
    const deps = createMockDeps()
    vi.mocked(deps.runDetectionForUser).mockRejectedValue(new Error('Detection failed'))
    const trigger = createDetectionTrigger(deps)

    trigger.triggerDetectionForUser('testuser')
    await vi.advanceTimersByTimeAsync(5000)

    // Should have logged the error via audit log
    expect(auditError).toHaveBeenCalledWith(
      'testuser',
      'data',
      'Location detection failed',
      expect.objectContaining({ error: expect.stringContaining('Detection failed') }),
    )

    // Should still clean up pending detection despite the error
    expect(trigger.hasPendingDetection('testuser')).toBe(false)
  })

  test('cleans up pending detection after completion', async () => {
    const deps = createMockDeps()
    const trigger = createDetectionTrigger(deps)

    trigger.triggerDetectionForUser('testuser')
    expect(trigger.hasPendingDetection('testuser')).toBe(true)

    await vi.advanceTimersByTimeAsync(5000)

    // After completion, should be cleaned up
    expect(trigger.hasPendingDetection('testuser')).toBe(false)
  })

  test('independent instances have separate state', () => {
    const deps1 = createMockDeps()
    const deps2 = createMockDeps()

    const trigger1 = createDetectionTrigger(deps1)
    const trigger2 = createDetectionTrigger(deps2)

    trigger1.triggerDetectionForUser('user1')

    expect(trigger1.getPendingDetectionCount()).toBe(1)
    expect(trigger2.getPendingDetectionCount()).toBe(0)
  })

  test('proactively materializes location_visit activities for opted-in named visits', async () => {
    const deps = createMockDeps()
    const start = new Date('2026-04-20T08:00:00Z')
    const end = new Date('2026-04-20T09:30:00Z')
    vi.mocked(deps.getPlaceVisits).mockResolvedValue([
      {
        duration_minutes: 90,
        end_time: end,
        lat: 59.33,
        lon: 18.07,
        name: 'Home',
        named_location_id: 'nl-home',
        source: 'named',
        start_time: start,
      },
    ] as never)
    vi.mocked(deps.getNamedLocations).mockResolvedValue([
      {
        auto_create_activity: true,
        id: 'nl-home',
        lat: 59.33,
        lon: 18.07,
        name: 'Home',
        radius: 100,
      },
    ] as never)

    const trigger = createDetectionTrigger(deps)
    trigger.triggerDetectionForUser('testuser')
    await vi.advanceTimersByTimeAsync(5000)

    expect(deps.insertActivities).toHaveBeenCalledWith(
      'testuser',
      expect.arrayContaining([
        expect.objectContaining({
          activity_type: 'location_visit',
          external_id: `locvisit_nl-home_${start.getTime()}`,
        }),
      ]),
    )
  })

  test('skips materialization when no opted-in named locations exist', async () => {
    const deps = createMockDeps()
    vi.mocked(deps.getPlaceVisits).mockResolvedValue([
      {
        duration_minutes: 30,
        end_time: new Date(),
        lat: 0,
        lon: 0,
        name: 'X',
        named_location_id: 'nl-x',
        source: 'named',
        start_time: new Date(),
      },
    ] as never)
    // No opted-in locations
    vi.mocked(deps.getNamedLocations).mockResolvedValue([
      { auto_create_activity: false, id: 'nl-x', lat: 0, lon: 0, name: 'X', radius: 100 },
    ] as never)

    const trigger = createDetectionTrigger(deps)
    trigger.triggerDetectionForUser('testuser')
    await vi.advanceTimersByTimeAsync(5000)

    expect(deps.insertActivities).not.toHaveBeenCalled()
  })

  test('materialization failure does not derail detection bookkeeping', async () => {
    const { auditError } = await import('./audit-log.ts')
    const deps = createMockDeps()
    vi.mocked(deps.getPlaceVisits).mockRejectedValue(new Error('boom'))

    const trigger = createDetectionTrigger(deps)
    trigger.triggerDetectionForUser('testuser')
    await vi.advanceTimersByTimeAsync(5000)

    expect(deps.runDetectionForUser).toHaveBeenCalled()
    expect(auditError).toHaveBeenCalledWith(
      'testuser',
      'data',
      'location_visit materialization failed',
      expect.objectContaining({ error: expect.stringContaining('boom') }),
    )
    // Pending tracker still cleans up
    expect(trigger.hasPendingDetection('testuser')).toBe(false)
  })
})
