import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import { parseMetricEntityId, toMetricEntityId } from './metric-entity-id.ts'
import {
  addActivity,
  addCustomMetric,
  addMetric,
  bulkAddMetrics,
  deleteActivity,
  deleteCustomMetric,
  deleteMetric,
  deleteMetricData,
  getCustomMetrics,
  mergeActivities,
  updateActivity,
  updateCustomMetric,
} from './mutations.ts'

// Mock the db module
vi.mock('../db', () => ({
  activityTypeExists: vi.fn().mockResolvedValue(true),
  checkActivityConflict: vi.fn().mockResolvedValue(false),
  getActivityTypeDefinition: vi.fn().mockResolvedValue(null),
  deleteActivity: vi.fn(),
  deleteCustomMetricDefinition: vi.fn(),
  deleteTimeSeriesMetric: vi.fn(),
  deleteTimeSeriesPoint: vi.fn(),
  enqueueOutboundSync: vi.fn().mockResolvedValue(undefined),
  findHcRecordId: vi.fn().mockResolvedValue(null),
  findMergeableActivity: vi.fn().mockResolvedValue(null),
  getActivityById: vi.fn(),
  getCustomMetricByName: vi.fn(),
  getCustomMetricDefinitions: vi.fn().mockResolvedValue([]),
  getUserSettings: vi.fn(),
  insertCustomMetricDefinition: vi.fn(),
  insertActivity: vi.fn(),
  insertNewActivity: vi.fn().mockResolvedValue('new-id'),
  insertTimeSeries: vi.fn(),
  materializeSuperseded: vi.fn().mockResolvedValue(undefined),
  resolveOrCreateActivityType: vi
    .fn()
    .mockImplementation((_user: string, tagName: string) =>
      Promise.resolve(tagName.toLowerCase().replaceAll(/\s+/g, '_')),
    ),
  updateActivity: vi.fn(),
  updateCustomMetricDefinition: vi.fn(),
  upsertUserSettings: vi.fn(),
}))

// Mock notes service to avoid testing note-sync behavior here
vi.mock('./notes', () => ({
  syncNoteTimesForEntity: vi.fn().mockResolvedValue(undefined),
}))

describe('addMetric', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('creates a metric measurement', async () => {
    vi.mocked(db.insertTimeSeries).mockResolvedValue(undefined)

    const result = await addMetric('testuser', {
      metric: 'weight',
      time: new Date('2024-01-15T08:00:00Z'),
      value: 75.5,
    })

    expect(result.success).toBe(true)
    expect(result.metric).toBe('weight')
    expect(result.value).toBe(75.5)
    expect(result.unit).toBe('kg')
    expect(result.time).toBe('2024-01-15T08:00:00.000Z')

    expect(db.insertTimeSeries).toHaveBeenCalledWith('testuser', [
      {
        metric: 'weight',
        source: 'aurboda',
        time: new Date('2024-01-15T08:00:00Z'),
        unit: 'kg',
        value: 75.5,
      },
    ])
  })

  test('returns correct unit for different metrics', async () => {
    vi.mocked(db.insertTimeSeries).mockResolvedValue(undefined)

    const hrResult = await addMetric('testuser', {
      metric: 'heart_rate',
      time: new Date('2024-01-15T10:00:00Z'),
      value: 72,
    })
    expect(hrResult.unit).toBe('bpm')

    const hrvResult = await addMetric('testuser', {
      metric: 'hrv_rmssd',
      time: new Date('2024-01-15T10:00:00Z'),
      value: 45,
    })
    expect(hrvResult.unit).toBe('ms')

    const stepsResult = await addMetric('testuser', {
      metric: 'steps',
      time: new Date('2024-01-15T10:00:00Z'),
      value: 5000,
    })
    expect(stepsResult.unit).toBe('count')
  })
})

describe('addActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('creates an exercise activity with required fields', async () => {
    vi.mocked(db.insertActivity).mockResolvedValue('test-id')

    const result = await addActivity('testuser', {
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:45:00Z'),
      start_time: new Date('2024-03-15T10:30:00Z'),
    })

    expect(result.success).toBe(true)
    expect(result.activity_type).toBe('exercise')
    expect(result.start_time).toBe('2024-03-15T10:30:00.000Z')
    expect(result.end_time).toBe('2024-03-15T11:45:00.000Z')
    expect(result.id).toBeDefined()

    expect(db.insertActivity).toHaveBeenCalledWith('testuser', {
      activity_type: 'exercise',
      data: undefined,
      end_time: new Date('2024-03-15T11:45:00Z'),
      id: expect.any(String),
      notes: undefined,
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:30:00Z'),
      title: undefined,
    })
  })

  test('creates an activity with all fields', async () => {
    vi.mocked(db.insertActivity).mockResolvedValue('test-id')

    const result = await addActivity('testuser', {
      activity_type: 'exercise',
      data: { exerciseType: 79 },
      end_time: new Date('2024-03-15T11:45:00Z'),
      notes: 'Dumbbell Bench Press: 12×30kg, 8×35kg',
      start_time: new Date('2024-03-15T10:30:00Z'),
      title: 'Upper body',
    })

    expect(result.success).toBe(true)
    expect(result.title).toBe('Upper body')
    expect(result.notes).toBe('Dumbbell Bench Press: 12×30kg, 8×35kg')
    expect(result.id).toBeDefined()

    expect(db.insertActivity).toHaveBeenCalledWith('testuser', {
      activity_type: 'exercise',
      data: { exerciseType: 79 },
      end_time: new Date('2024-03-15T11:45:00Z'),
      id: expect.any(String),
      notes: 'Dumbbell Bench Press: 12×30kg, 8×35kg',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:30:00Z'),
      title: 'Upper body',
    })
  })

  test('returns error when endTime is before startTime', async () => {
    const result = await addActivity('testuser', {
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T09:00:00Z'),
      start_time: new Date('2024-03-15T10:30:00Z'),
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('end_time must not be before start_time')
    expect(db.insertActivity).not.toHaveBeenCalled()
  })

  test('allows endTime equal to startTime', async () => {
    vi.mocked(db.insertActivity).mockResolvedValue('test-id')

    const result = await addActivity('testuser', {
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T10:30:00Z'),
      start_time: new Date('2024-03-15T10:30:00Z'),
    })

    expect(result.success).toBe(true)
    expect(db.insertActivity).toHaveBeenCalled()
  })

  test('creates meditation activity', async () => {
    vi.mocked(db.insertActivity).mockResolvedValue('test-id')

    const result = await addActivity('testuser', {
      activity_type: 'meditation',
      end_time: new Date('2024-03-15T07:30:00Z'),
      start_time: new Date('2024-03-15T07:00:00Z'),
      title: 'Morning meditation',
    })

    expect(result.success).toBe(true)
    expect(result.activity_type).toBe('meditation')

    expect(db.insertActivity).toHaveBeenCalledWith('testuser', {
      activity_type: 'meditation',
      data: undefined,
      end_time: new Date('2024-03-15T07:30:00Z'),
      id: expect.any(String),
      notes: undefined,
      source: 'aurboda',
      start_time: new Date('2024-03-15T07:00:00Z'),
      title: 'Morning meditation',
    })
  })

  test('creates nap activity', async () => {
    vi.mocked(db.insertActivity).mockResolvedValue('test-id')

    const result = await addActivity('testuser', {
      activity_type: 'nap',
      end_time: new Date('2024-03-15T14:30:00Z'),
      start_time: new Date('2024-03-15T14:00:00Z'),
    })

    expect(result.success).toBe(true)
    expect(result.activity_type).toBe('nap')
  })

  test('calls onMutated callback after successful insert', async () => {
    vi.mocked(db.insertActivity).mockResolvedValue('test-id')
    const onMutated = vi.fn()

    await addActivity(
      'testuser',
      {
        activity_type: 'exercise',
        end_time: new Date('2024-03-15T11:00:00Z'),
        start_time: new Date('2024-03-15T10:00:00Z'),
      },
      onMutated,
    )

    expect(onMutated).toHaveBeenCalledWith(
      'testuser',
      'exercise',
      new Date('2024-03-15T10:00:00Z'),
      new Date('2024-03-15T11:00:00Z'),
    )
  })

  test('calls onMutated callback after merge-span extension', async () => {
    vi.mocked(db.findMergeableActivity).mockResolvedValue({
      activity_type: 'computer_active',
      id: 'existing-id',
      start_time: new Date('2024-03-15T10:00:00Z'),
    } as never)
    vi.mocked(db.updateActivity).mockResolvedValue({} as never)
    const onMutated = vi.fn()

    await addActivity(
      'testuser',
      {
        activity_type: 'computer_active',
        merge_span: 120,
        start_time: new Date('2024-03-15T10:05:00Z'),
      },
      onMutated,
    )

    expect(onMutated).toHaveBeenCalledWith(
      'testuser',
      'computer_active',
      new Date('2024-03-15T10:00:00Z'),
      new Date('2024-03-15T10:05:00Z'),
    )
  })

  test('does not call onMutated on validation failure', async () => {
    vi.mocked(db.activityTypeExists).mockResolvedValue(false)
    const onMutated = vi.fn()

    await addActivity(
      'testuser',
      {
        activity_type: 'nonexistent',
        start_time: new Date('2024-03-15T10:00:00Z'),
      },
      onMutated,
    )

    expect(onMutated).not.toHaveBeenCalled()
    vi.mocked(db.activityTypeExists).mockResolvedValue(true)
  })
})

describe('addCustomMetric', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('creates a custom metric definition', async () => {
    vi.mocked(db.getCustomMetricByName).mockResolvedValue(null)

    const result = await addCustomMetric('testuser', { name: 'mood', unit: 'score' })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ name: 'mood', unit: 'score' })
    expect(db.insertCustomMetricDefinition).toHaveBeenCalledWith('testuser', { name: 'mood', unit: 'score' })
  })

  test('creates a custom metric with all fields', async () => {
    vi.mocked(db.getCustomMetricByName).mockResolvedValue(null)

    const result = await addCustomMetric('testuser', {
      description: 'Daily mood rating',
      max_value: 10,
      min_value: 1,
      name: 'mood',
      unit: 'score',
    })

    expect(result.success).toBe(true)
    expect(result.data?.description).toBe('Daily mood rating')
    expect(result.data?.min_value).toBe(1)
    expect(result.data?.max_value).toBe(10)
  })

  test('rejects name conflicting with built-in metric', async () => {
    const result = await addCustomMetric('testuser', { name: 'heart_rate', unit: 'bpm' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('conflicts with a built-in metric')
    expect(db.insertCustomMetricDefinition).not.toHaveBeenCalled()
  })

  test('rejects duplicate custom metric name', async () => {
    vi.mocked(db.getCustomMetricByName).mockResolvedValue({ name: 'mood', unit: 'score' })

    const result = await addCustomMetric('testuser', { name: 'mood', unit: 'points' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('already exists')
    expect(db.insertCustomMetricDefinition).not.toHaveBeenCalled()
  })

  test('works when no metrics exist yet', async () => {
    vi.mocked(db.getCustomMetricByName).mockResolvedValue(null)

    const result = await addCustomMetric('testuser', { name: 'mood', unit: 'score' })

    expect(result.success).toBe(true)
    expect(db.insertCustomMetricDefinition).toHaveBeenCalledWith('testuser', { name: 'mood', unit: 'score' })
  })
})

describe('deleteCustomMetric', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('deletes an existing custom metric', async () => {
    vi.mocked(db.deleteCustomMetricDefinition).mockResolvedValue(true)

    const result = await deleteCustomMetric('testuser', 'mood')

    expect(result.success).toBe(true)
    expect(result.deleted).toBe(true)
    expect(db.deleteCustomMetricDefinition).toHaveBeenCalledWith('testuser', 'mood')
  })

  test('returns false when metric not found', async () => {
    vi.mocked(db.deleteCustomMetricDefinition).mockResolvedValue(false)

    const result = await deleteCustomMetric('testuser', 'nonexistent')

    expect(result.success).toBe(false)
    expect(result.deleted).toBe(false)
  })
})

describe('getCustomMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns custom metrics from database', async () => {
    vi.mocked(db.getCustomMetricDefinitions).mockResolvedValue([
      { name: 'mood', unit: 'score' },
      { name: 'caffeine_mg', unit: 'mg' },
    ])

    const result = await getCustomMetrics('testuser')

    expect(result).toEqual([
      { name: 'mood', unit: 'score' },
      { name: 'caffeine_mg', unit: 'mg' },
    ])
  })

  test('returns empty array when no custom metrics', async () => {
    vi.mocked(db.getCustomMetricDefinitions).mockResolvedValue([])

    const result = await getCustomMetrics('testuser')

    expect(result).toEqual([])
  })
})

describe('addMetric with custom metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('adds a custom metric measurement', async () => {
    vi.mocked(db.insertTimeSeries).mockResolvedValue(undefined)
    vi.mocked(db.getCustomMetricDefinitions).mockResolvedValue([{ name: 'mood', unit: 'score' }])

    const result = await addMetric('testuser', {
      metric: 'mood',
      time: new Date('2024-01-15T08:00:00Z'),
      value: 8,
    })

    expect(result.success).toBe(true)
    expect(result.metric).toBe('mood')
    expect(result.unit).toBe('score')
    expect(result.value).toBe(8)

    expect(db.insertTimeSeries).toHaveBeenCalledWith('testuser', [
      {
        metric: 'mood',
        source: 'aurboda',
        time: new Date('2024-01-15T08:00:00Z'),
        unit: 'score',
        value: 8,
      },
    ])
  })

  test('rejects unknown metric name', async () => {
    vi.mocked(db.getCustomMetricDefinitions).mockResolvedValue([])

    const result = await addMetric('testuser', {
      metric: 'unknown_metric',
      time: new Date('2024-01-15T08:00:00Z'),
      value: 42,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid metric')
    expect(db.insertTimeSeries).not.toHaveBeenCalled()
  })

  test('validates custom metric value against min/max', async () => {
    vi.mocked(db.getCustomMetricDefinitions).mockResolvedValue([
      { max_value: 10, min_value: 1, name: 'mood', unit: 'score' },
    ])

    const result = await addMetric('testuser', {
      metric: 'mood',
      time: new Date('2024-01-15T08:00:00Z'),
      value: 15,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('exceeds maximum')
    expect(db.insertTimeSeries).not.toHaveBeenCalled()
  })

  test('validates custom metric value against min', async () => {
    vi.mocked(db.getCustomMetricDefinitions).mockResolvedValue([
      { max_value: 10, min_value: 1, name: 'mood', unit: 'score' },
    ])

    const result = await addMetric('testuser', {
      metric: 'mood',
      time: new Date('2024-01-15T08:00:00Z'),
      value: 0,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('below minimum')
    expect(db.insertTimeSeries).not.toHaveBeenCalled()
  })
})

describe('bulkAddMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('inserts multiple built-in metrics in a single batch', async () => {
    vi.mocked(db.insertTimeSeries).mockResolvedValue(undefined)
    vi.mocked(db.getCustomMetricDefinitions).mockResolvedValue([])

    const result = await bulkAddMetrics('testuser', [
      { metric: 'heart_rate', time: new Date('2024-01-15T10:00:00Z'), value: 72 },
      { metric: 'heart_rate', time: new Date('2024-01-15T10:05:00Z'), value: 75 },
      { metric: 'weight', time: new Date('2024-01-15T08:00:00Z'), value: 75.5 },
    ])

    expect(result.success).toBe(true)
    expect(result.inserted).toBe(3)
    expect(result.errors).toHaveLength(0)

    expect(db.insertTimeSeries).toHaveBeenCalledTimes(1)
    expect(db.insertTimeSeries).toHaveBeenCalledWith('testuser', [
      {
        metric: 'heart_rate',
        source: 'aurboda',
        time: new Date('2024-01-15T10:00:00Z'),
        unit: 'bpm',
        value: 72,
      },
      {
        metric: 'heart_rate',
        source: 'aurboda',
        time: new Date('2024-01-15T10:05:00Z'),
        unit: 'bpm',
        value: 75,
      },
      {
        metric: 'weight',
        source: 'aurboda',
        time: new Date('2024-01-15T08:00:00Z'),
        unit: 'kg',
        value: 75.5,
      },
    ])
  })

  test('collects per-item errors without failing the batch', async () => {
    vi.mocked(db.insertTimeSeries).mockResolvedValue(undefined)
    vi.mocked(db.getCustomMetricDefinitions).mockResolvedValue([])

    const result = await bulkAddMetrics('testuser', [
      { metric: 'heart_rate', time: new Date('2024-01-15T10:00:00Z'), value: 72 },
      { metric: 'invalid_metric', time: new Date('2024-01-15T10:05:00Z'), value: 42 },
      { metric: 'weight', time: new Date('2024-01-15T08:00:00Z'), value: 75.5 },
    ])

    expect(result.success).toBe(true)
    expect(result.inserted).toBe(2)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual({
      error: 'Invalid metric "invalid_metric"',
      index: 1,
    })
  })

  test('validates custom metric ranges', async () => {
    vi.mocked(db.insertTimeSeries).mockResolvedValue(undefined)
    vi.mocked(db.getCustomMetricDefinitions).mockResolvedValue([
      { max_value: 10, min_value: 1, name: 'mood', unit: 'score' },
    ])

    const result = await bulkAddMetrics('testuser', [
      { metric: 'mood', time: new Date('2024-01-15T10:00:00Z'), value: 5 },
      { metric: 'mood', time: new Date('2024-01-15T11:00:00Z'), value: 15 },
      { metric: 'mood', time: new Date('2024-01-15T12:00:00Z'), value: 0 },
    ])

    expect(result.success).toBe(true)
    expect(result.inserted).toBe(1)
    expect(result.errors).toHaveLength(2)
    expect(result.errors[0].index).toBe(1)
    expect(result.errors[0].error).toContain('exceeds maximum')
    expect(result.errors[1].index).toBe(2)
    expect(result.errors[1].error).toContain('below minimum')
  })

  test('uses default source when no per-item source specified', async () => {
    vi.mocked(db.insertTimeSeries).mockResolvedValue(undefined)
    vi.mocked(db.getCustomMetricDefinitions).mockResolvedValue([])

    await bulkAddMetrics(
      'testuser',
      [{ metric: 'heart_rate', time: new Date('2024-01-15T10:00:00Z'), value: 72 }],
      'oura',
    )

    expect(db.insertTimeSeries).toHaveBeenCalledWith('testuser', [
      expect.objectContaining({ source: 'oura' }),
    ])
  })

  test('per-item source overrides default source', async () => {
    vi.mocked(db.insertTimeSeries).mockResolvedValue(undefined)
    vi.mocked(db.getCustomMetricDefinitions).mockResolvedValue([])

    await bulkAddMetrics(
      'testuser',
      [
        { metric: 'heart_rate', source: 'garmin', time: new Date('2024-01-15T10:00:00Z'), value: 72 },
        { metric: 'heart_rate', time: new Date('2024-01-15T10:05:00Z'), value: 75 },
      ],
      'oura',
    )

    expect(db.insertTimeSeries).toHaveBeenCalledWith('testuser', [
      expect.objectContaining({ source: 'garmin' }),
      expect.objectContaining({ source: 'oura' }),
    ])
  })

  test('defaults source to aurboda when not specified', async () => {
    vi.mocked(db.insertTimeSeries).mockResolvedValue(undefined)
    vi.mocked(db.getCustomMetricDefinitions).mockResolvedValue([])

    await bulkAddMetrics('testuser', [
      { metric: 'heart_rate', time: new Date('2024-01-15T10:00:00Z'), value: 72 },
    ])

    expect(db.insertTimeSeries).toHaveBeenCalledWith('testuser', [
      expect.objectContaining({ source: 'aurboda' }),
    ])
  })

  test('does not call insertTimeSeries when all items are invalid', async () => {
    vi.mocked(db.getCustomMetricDefinitions).mockResolvedValue([])

    const result = await bulkAddMetrics('testuser', [
      { metric: 'unknown1', time: new Date('2024-01-15T10:00:00Z'), value: 1 },
      { metric: 'unknown2', time: new Date('2024-01-15T10:05:00Z'), value: 2 },
    ])

    expect(result.success).toBe(true)
    expect(result.inserted).toBe(0)
    expect(result.errors).toHaveLength(2)
    expect(db.insertTimeSeries).not.toHaveBeenCalled()
  })

  test('calls getCustomMetricDefinitions only once for the entire batch', async () => {
    vi.mocked(db.insertTimeSeries).mockResolvedValue(undefined)
    vi.mocked(db.getCustomMetricDefinitions).mockResolvedValue([{ name: 'mood', unit: 'score' }])

    await bulkAddMetrics('testuser', [
      { metric: 'mood', time: new Date('2024-01-15T10:00:00Z'), value: 5 },
      { metric: 'mood', time: new Date('2024-01-15T11:00:00Z'), value: 7 },
      { metric: 'heart_rate', time: new Date('2024-01-15T10:00:00Z'), value: 72 },
    ])

    expect(db.getCustomMetricDefinitions).toHaveBeenCalledTimes(1)
  })
})

describe('deleteActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('deletes activity and returns success when found', async () => {
    vi.mocked(db.deleteActivity).mockResolvedValue(true)

    const result = await deleteActivity('testuser', 'activity-123')

    expect(result.success).toBe(true)
    expect(result.deleted).toBe(true)
    expect(result.id).toBe('activity-123')
    expect(db.deleteActivity).toHaveBeenCalledWith('testuser', 'activity-123')
  })

  test('returns success false when activity not found', async () => {
    vi.mocked(db.deleteActivity).mockResolvedValue(false)

    const result = await deleteActivity('testuser', 'nonexistent-activity')

    expect(result.success).toBe(false)
    expect(result.deleted).toBe(false)
    expect(result.id).toBe('nonexistent-activity')
  })
})

describe('updateActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('updates activity times successfully', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.updateActivity).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T12:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T09:00:00Z'),
    })

    const result = await updateActivity('testuser', 'activity-123', {
      end_time: new Date('2024-03-15T12:00:00Z'),
      start_time: new Date('2024-03-15T09:00:00Z'),
    })

    expect(result.success).toBe(true)
    expect(result.start_time).toBe('2024-03-15T09:00:00.000Z')
    expect(result.end_time).toBe('2024-03-15T12:00:00.000Z')
    expect(db.updateActivity).toHaveBeenCalledWith('testuser', 'activity-123', {
      activity_type: undefined,
      end_time: new Date('2024-03-15T12:00:00Z'),
      notes: undefined,
      start_time: new Date('2024-03-15T09:00:00Z'),
      title: undefined,
    })
  })

  test('updates activity title and notes', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.updateActivity).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      notes: 'Felt great!',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
      title: 'Morning workout',
    })

    const result = await updateActivity('testuser', 'activity-123', {
      notes: 'Felt great!',
      title: 'Morning workout',
    })

    expect(result.success).toBe(true)
    expect(result.title).toBe('Morning workout')
    expect(result.notes).toBe('Felt great!')
  })

  test('returns error when activity not found', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue(null)

    const result = await updateActivity('testuser', 'nonexistent-activity', {
      title: 'New title',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Activity not found')
    expect(result.id).toBe('nonexistent-activity')
    expect(db.updateActivity).not.toHaveBeenCalled()
  })

  test('returns error when new end_time is before existing start_time', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })

    const result = await updateActivity('testuser', 'activity-123', {
      end_time: new Date('2024-03-15T09:00:00Z'), // Before existing start_time
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('end_time must not be before start_time')
    expect(db.updateActivity).not.toHaveBeenCalled()
  })

  test('returns error when new start_time is after existing end_time', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })

    const result = await updateActivity('testuser', 'activity-123', {
      start_time: new Date('2024-03-15T12:00:00Z'), // After existing end_time
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('end_time must not be before start_time')
    expect(db.updateActivity).not.toHaveBeenCalled()
  })

  test('validates both new start and end times together', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })

    const result = await updateActivity('testuser', 'activity-123', {
      end_time: new Date('2024-03-15T08:00:00Z'),
      start_time: new Date('2024-03-15T09:00:00Z'), // end_time before start_time
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('end_time must not be before start_time')
    expect(db.updateActivity).not.toHaveBeenCalled()
  })

  test('merges data with existing activity data', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      data: { exerciseType: 70, exerciseTypeName: 'strength_training' },
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.updateActivity).mockResolvedValue({
      activity_type: 'exercise',
      data: { exerciseType: 81, exerciseTypeName: 'weightlifting' },
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })

    await updateActivity('testuser', 'activity-123', {
      data: { exerciseType: 81, exerciseTypeName: 'weightlifting' },
    })

    expect(db.updateActivity).toHaveBeenCalledWith('testuser', 'activity-123', {
      activity_type: undefined,
      data: { exerciseType: 81, exerciseTypeName: 'weightlifting' },
      end_time: undefined,
      notes: undefined,
      start_time: undefined,
      title: undefined,
    })
  })

  test('merges new data fields while preserving existing ones', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      data: { calories: 300, exerciseType: 70, exerciseTypeName: 'strength_training' },
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.updateActivity).mockResolvedValue({
      activity_type: 'exercise',
      data: { calories: 300, exerciseType: 81, exerciseTypeName: 'weightlifting' },
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })

    await updateActivity('testuser', 'activity-123', {
      data: { exerciseType: 81, exerciseTypeName: 'weightlifting' },
    })

    // Should merge: existing {calories, exerciseType, exerciseTypeName} + new {exerciseType, exerciseTypeName}
    expect(db.updateActivity).toHaveBeenCalledWith('testuser', 'activity-123', {
      activity_type: undefined,
      data: { calories: 300, exerciseType: 81, exerciseTypeName: 'weightlifting' },
      end_time: undefined,
      notes: undefined,
      start_time: undefined,
      title: undefined,
    })
  })

  test('sets data on activity with no existing data', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.updateActivity).mockResolvedValue({
      activity_type: 'exercise',
      data: { exerciseType: 56, exerciseTypeName: 'running' },
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })

    await updateActivity('testuser', 'activity-123', {
      data: { exerciseType: 56, exerciseTypeName: 'running' },
    })

    expect(db.updateActivity).toHaveBeenCalledWith('testuser', 'activity-123', {
      activity_type: undefined,
      data: { exerciseType: 56, exerciseTypeName: 'running' },
      end_time: undefined,
      notes: undefined,
      start_time: undefined,
      title: undefined,
    })
  })

  test('does not pass data when input has no data field', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      data: { exerciseType: 70 },
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.updateActivity).mockResolvedValue({
      activity_type: 'exercise',
      data: { exerciseType: 70 },
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      notes: 'Updated notes',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })

    await updateActivity('testuser', 'activity-123', {
      notes: 'Updated notes',
    })

    // data should be undefined (not touched) when not provided in input
    expect(db.updateActivity).toHaveBeenCalledWith('testuser', 'activity-123', {
      activity_type: undefined,
      data: undefined,
      end_time: undefined,
      notes: 'Updated notes',
      start_time: undefined,
      title: undefined,
    })
  })

  test('updates data and other fields together', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.updateActivity).mockResolvedValue({
      activity_type: 'exercise',
      data: { exerciseType: 81, exerciseTypeName: 'weightlifting' },
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
      title: 'Heavy lifting',
    })

    const result = await updateActivity('testuser', 'activity-123', {
      data: { exerciseType: 81, exerciseTypeName: 'weightlifting' },
      title: 'Heavy lifting',
    })

    expect(result.success).toBe(true)
    expect(result.title).toBe('Heavy lifting')
    expect(db.updateActivity).toHaveBeenCalledWith('testuser', 'activity-123', {
      activity_type: undefined,
      data: { exerciseType: 81, exerciseTypeName: 'weightlifting' },
      end_time: undefined,
      notes: undefined,
      start_time: undefined,
      title: 'Heavy lifting',
    })
  })

  test('updates activity_type successfully', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'garmin',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.checkActivityConflict).mockResolvedValue(false)
    vi.mocked(db.updateActivity).mockResolvedValue({
      activity_type: 'meditation',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'garmin',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })

    const result = await updateActivity('testuser', 'activity-123', {
      activity_type: 'meditation',
    })

    expect(result.success).toBe(true)
    expect(result.activity_type).toBe('meditation')
    expect(db.updateActivity).toHaveBeenCalledWith('testuser', 'activity-123', {
      activity_type: 'meditation',
      data: { _user_edited: true },
      end_time: undefined,
      notes: undefined,
      start_time: undefined,
      title: undefined,
    })
  })

  test('returns error when activity_type change would violate unique constraint', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'garmin',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.checkActivityConflict).mockResolvedValue(true)

    const result = await updateActivity('testuser', 'activity-123', {
      activity_type: 'meditation',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot change activity type')
    expect(db.updateActivity).not.toHaveBeenCalled()
  })

  test('skips conflict check when activity_type is not changing', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.updateActivity).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
      title: 'Updated',
    })

    await updateActivity('testuser', 'activity-123', { title: 'Updated' })

    expect(db.checkActivityConflict).not.toHaveBeenCalled()
  })

  test('enqueues HC delete when changing from exercise to meditation (aurboda source)', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.checkActivityConflict).mockResolvedValue(false)
    vi.mocked(db.findHcRecordId).mockResolvedValue('hc-record-456')
    vi.mocked(db.updateActivity).mockResolvedValue({
      activity_type: 'meditation',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })

    await updateActivity('testuser', 'activity-123', {
      activity_type: 'meditation',
    })

    // Should enqueue a delete for the old exercise HC record
    expect(db.enqueueOutboundSync).toHaveBeenCalledWith('testuser', {
      entity_id: 'activity-123',
      entity_type: 'activity',
      hc_record_type: 'ExerciseSessionRecord',
      operation: 'delete',
      payload: { hc_record_id: 'hc-record-456' },
    })
    // Should NOT enqueue an insert for meditation (not HC-syncable)
    expect(db.enqueueOutboundSync).toHaveBeenCalledTimes(1)
  })

  test('enqueues HC insert when changing from meditation to exercise (aurboda source)', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'meditation',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.checkActivityConflict).mockResolvedValue(false)
    vi.mocked(db.updateActivity).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })

    await updateActivity('testuser', 'activity-123', {
      activity_type: 'exercise',
    })

    // Should enqueue an insert for the new exercise HC record
    expect(db.enqueueOutboundSync).toHaveBeenCalledWith('testuser', {
      entity_id: 'activity-123',
      entity_type: 'activity',
      hc_record_type: 'ExerciseSessionRecord',
      operation: 'insert',
      payload: expect.objectContaining({ activity_type: 'exercise' }),
    })
  })

  test('calls onMutated callback after successful update', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.updateActivity).mockResolvedValue({
      activity_type: 'exercise',
      end_time: new Date('2024-03-15T12:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T09:00:00Z'),
    })
    const onMutated = vi.fn()

    await updateActivity('testuser', 'activity-123', { title: 'Updated' }, onMutated)

    expect(onMutated).toHaveBeenCalledWith(
      'testuser',
      'exercise',
      new Date('2024-03-15T09:00:00Z'),
      new Date('2024-03-15T12:00:00Z'),
    )
  })

  test('calls onMutated for both old and new type on type change', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'nap',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.updateActivity).mockResolvedValue({
      activity_type: 'rest',
      end_time: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'aurboda',
      start_time: new Date('2024-03-15T10:00:00Z'),
    })
    const onMutated = vi.fn()

    await updateActivity('testuser', 'activity-123', { activity_type: 'rest' }, onMutated)

    expect(onMutated).toHaveBeenCalledTimes(2)
    expect(onMutated).toHaveBeenCalledWith(
      'testuser',
      'rest',
      new Date('2024-03-15T10:00:00Z'),
      new Date('2024-03-15T11:00:00Z'),
    )
    expect(onMutated).toHaveBeenCalledWith(
      'testuser',
      'nap',
      new Date('2024-03-15T10:00:00Z'),
      new Date('2024-03-15T11:00:00Z'),
    )
  })

  test('does not call onMutated when activity not found', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue(null)
    const onMutated = vi.fn()

    await updateActivity('testuser', 'nonexistent', { title: 'x' }, onMutated)

    expect(onMutated).not.toHaveBeenCalled()
  })
})

describe('updateCustomMetric', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('updates unit field', async () => {
    vi.mocked(db.updateCustomMetricDefinition).mockResolvedValue({ name: 'mood', unit: 'points' })

    const result = await updateCustomMetric('testuser', 'mood', { unit: 'points' })

    expect(result.success).toBe(true)
    expect(result.data?.unit).toBe('points')
  })

  test('updates description field', async () => {
    vi.mocked(db.updateCustomMetricDefinition).mockResolvedValue({
      description: 'Daily mood rating',
      name: 'mood',
      unit: 'score',
    })

    const result = await updateCustomMetric('testuser', 'mood', { description: 'Daily mood rating' })

    expect(result.success).toBe(true)
    expect(result.data?.description).toBe('Daily mood rating')
  })

  test('clears min_value with null', async () => {
    vi.mocked(db.updateCustomMetricDefinition).mockResolvedValue({
      max_value: 10,
      name: 'mood',
      unit: 'score',
    })

    const result = await updateCustomMetric('testuser', 'mood', { minValue: null })

    expect(result.success).toBe(true)
    expect(result.data?.min_value).toBeUndefined()
    expect(result.data?.max_value).toBe(10)
  })

  test('clears max_value with null', async () => {
    vi.mocked(db.updateCustomMetricDefinition).mockResolvedValue({
      min_value: 1,
      name: 'mood',
      unit: 'score',
    })

    const result = await updateCustomMetric('testuser', 'mood', { maxValue: null })

    expect(result.success).toBe(true)
    expect(result.data?.max_value).toBeUndefined()
    expect(result.data?.min_value).toBe(1)
  })

  test('returns error when metric not found', async () => {
    vi.mocked(db.updateCustomMetricDefinition).mockResolvedValue(null)

    const result = await updateCustomMetric('testuser', 'nonexistent', { unit: 'mg' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  test('partial update preserves other fields', async () => {
    vi.mocked(db.updateCustomMetricDefinition).mockResolvedValue({
      description: 'Daily mood',
      max_value: 10,
      min_value: 1,
      name: 'mood',
      unit: 'points',
    })

    const result = await updateCustomMetric('testuser', 'mood', { unit: 'points' })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      description: 'Daily mood',
      max_value: 10,
      min_value: 1,
      name: 'mood',
      unit: 'points',
    })
  })
})

describe('deleteMetric', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('deletes a measurement and returns success', async () => {
    vi.mocked(db.deleteTimeSeriesPoint).mockResolvedValue(true)

    const result = await deleteMetric('testuser', 'weight', new Date('2024-01-15T08:00:00Z'), 'manual')

    expect(result.success).toBe(true)
    expect(result.deleted).toBe(true)
    expect(result.metric).toBe('weight')
    expect(result.time).toBe('2024-01-15T08:00:00.000Z')
    expect(db.deleteTimeSeriesPoint).toHaveBeenCalledWith(
      'testuser',
      'weight',
      new Date('2024-01-15T08:00:00Z'),
      'manual',
    )
  })

  test('returns false when measurement not found', async () => {
    vi.mocked(db.deleteTimeSeriesPoint).mockResolvedValue(false)

    const result = await deleteMetric('testuser', 'weight', new Date('2024-01-15T08:00:00Z'), 'manual')

    expect(result.success).toBe(false)
    expect(result.deleted).toBe(false)
  })
})

describe('deleteMetricData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('deletes all manual measurements and returns count', async () => {
    vi.mocked(db.deleteTimeSeriesMetric).mockResolvedValue(5)

    const result = await deleteMetricData('testuser', 'weight')

    expect(result.success).toBe(true)
    expect(result.metric).toBe('weight')
    expect(result.deletedCount).toBe(5)
    expect(db.deleteTimeSeriesMetric).toHaveBeenCalledWith('testuser', 'weight')
  })

  test('returns zero count when no manual data exists', async () => {
    vi.mocked(db.deleteTimeSeriesMetric).mockResolvedValue(0)

    const result = await deleteMetricData('testuser', 'heart_rate')

    expect(result.success).toBe(true)
    expect(result.deletedCount).toBe(0)
  })
})

describe('toMetricEntityId', () => {
  test('constructs composite key from parts', () => {
    const result = toMetricEntityId(new Date('2024-01-15T10:30:00.000Z'), 'heart_rate', 'oura')
    expect(result).toBe('2024-01-15T10:30:00.000Z|heart_rate|oura')
  })

  test('preserves millisecond precision', () => {
    const result = toMetricEntityId(new Date('2024-01-15T10:30:00.123Z'), 'weight', 'manual')
    expect(result).toBe('2024-01-15T10:30:00.123Z|weight|manual')
  })
})

describe('parseMetricEntityId', () => {
  test('parses valid composite key', () => {
    const result = parseMetricEntityId('2024-01-15T10:30:00.000Z|heart_rate|oura')
    expect(result).toEqual({
      metric: 'heart_rate',
      source: 'oura',
      time: new Date('2024-01-15T10:30:00.000Z'),
    })
  })

  test('returns null for invalid format (too few parts)', () => {
    expect(parseMetricEntityId('2024-01-15T10:30:00.000Z|heart_rate')).toBeNull()
  })

  test('returns null for invalid format (too many parts)', () => {
    expect(parseMetricEntityId('a|b|c|d')).toBeNull()
  })

  test('returns null for invalid time', () => {
    expect(parseMetricEntityId('not-a-date|heart_rate|oura')).toBeNull()
  })

  test('returns null for empty metric', () => {
    expect(parseMetricEntityId('2024-01-15T10:30:00.000Z||oura')).toBeNull()
  })

  test('returns null for empty source', () => {
    expect(parseMetricEntityId('2024-01-15T10:30:00.000Z|heart_rate|')).toBeNull()
  })

  test('roundtrips with toMetricEntityId', () => {
    const time = new Date('2024-01-15T10:30:00.000Z')
    const entityId = toMetricEntityId(time, 'weight', 'aurboda')
    const parsed = parseMetricEntityId(entityId)

    expect(parsed).toEqual({
      metric: 'weight',
      source: 'aurboda',
      time,
    })
  })
})

describe('mergeActivities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('calls onMutated callback after successful merge', async () => {
    const onMutated = vi.fn()
    const deps = {
      deleteActivity: vi.fn().mockResolvedValue(true),
      getActivityById: vi.fn().mockImplementation((_user: string, id: string) =>
        Promise.resolve({
          activity_type: 'exercise',
          end_time: id === 'a1' ? new Date('2024-03-15T11:00:00Z') : new Date('2024-03-15T12:30:00Z'),
          id,
          source: 'aurboda',
          start_time: id === 'a1' ? new Date('2024-03-15T10:00:00Z') : new Date('2024-03-15T12:00:00Z'),
        }),
      ),
      insertNewActivity: vi.fn().mockResolvedValue('merged-id'),
      materializeSuperseded: vi.fn().mockResolvedValue(undefined),
    }

    const result = await mergeActivities('testuser', { activity_ids: ['a1', 'a2'] }, deps, onMutated)

    expect(result.success).toBe(true)
    expect(onMutated).toHaveBeenCalledWith(
      'testuser',
      'exercise',
      new Date('2024-03-15T10:00:00Z'),
      new Date('2024-03-15T12:30:00Z'),
    )
  })
})
