import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as db from '../db'
import { addActivity, addMetric, addTag, deleteActivity, deleteTag, updateActivity } from './mutations'

// Mock the db module
vi.mock('../db', () => ({
  deleteActivity: vi.fn(),
  deleteTag: vi.fn(),
  findMergeableTag: vi.fn(),
  getActivityById: vi.fn(),
  insertActivity: vi.fn(),
  insertTag: vi.fn(),
  insertTimeSeries: vi.fn(),
  updateActivity: vi.fn(),
  updateTagEndTime: vi.fn(),
}))

describe('addTag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('creates a tag with start time only', async () => {
    vi.mocked(db.insertTag).mockResolvedValue(undefined)

    const result = await addTag('testuser', {
      startTime: new Date('2024-01-15T10:00:00Z'),
      tag: 'coffee',
    })

    expect(result.success).toBe(true)
    expect(result.tag).toBe('coffee')
    expect(result.startTime).toBe('2024-01-15T10:00:00.000Z')
    expect(result.endTime).toBeUndefined()
    expect(result.id).toBeDefined()

    expect(db.insertTag).toHaveBeenCalledWith('testuser', {
      endTime: undefined,
      externalId: expect.any(String),
      source: 'manual',
      startTime: new Date('2024-01-15T10:00:00Z'),
      tag: 'coffee',
    })
  })

  test('creates a tag with start and end time', async () => {
    vi.mocked(db.insertTag).mockResolvedValue(undefined)

    const result = await addTag('testuser', {
      endTime: new Date('2024-01-15T11:00:00Z'),
      startTime: new Date('2024-01-15T10:00:00Z'),
      tag: 'meditation',
    })

    expect(result.success).toBe(true)
    expect(result.startTime).toBe('2024-01-15T10:00:00.000Z')
    expect(result.endTime).toBe('2024-01-15T11:00:00.000Z')

    expect(db.insertTag).toHaveBeenCalledWith('testuser', {
      endTime: new Date('2024-01-15T11:00:00Z'),
      externalId: expect.any(String),
      source: 'manual',
      startTime: new Date('2024-01-15T10:00:00Z'),
      tag: 'meditation',
    })
  })

  test('does not include merged field when mergeSpan not specified', async () => {
    vi.mocked(db.insertTag).mockResolvedValue(undefined)

    const result = await addTag('testuser', {
      startTime: new Date('2024-01-15T10:00:00Z'),
      tag: 'coffee',
    })

    expect(result.success).toBe(true)
    expect(result.merged).toBeUndefined()
    expect(result.extendedBySeconds).toBeUndefined()
    expect(db.findMergeableTag).not.toHaveBeenCalled()
  })

  test('creates new tag with merged: false when no mergeable tag found', async () => {
    vi.mocked(db.findMergeableTag).mockResolvedValue(undefined)
    vi.mocked(db.insertTag).mockResolvedValue(undefined)

    const result = await addTag('testuser', {
      mergeSpan: 180,
      startTime: new Date('2024-01-15T10:00:00Z'),
      tag: 'computer:dharma',
    })

    expect(result.success).toBe(true)
    expect(result.merged).toBe(false)
    expect(result.extendedBySeconds).toBeUndefined()
    expect(result.id).toBeDefined()

    expect(db.findMergeableTag).toHaveBeenCalledWith(
      'testuser',
      'computer:dharma',
      new Date('2024-01-15T10:00:00Z'),
      180,
    )
    expect(db.insertTag).toHaveBeenCalled()
    expect(db.updateTagEndTime).not.toHaveBeenCalled()
  })

  test('extends existing tag when mergeable tag found', async () => {
    vi.mocked(db.findMergeableTag).mockResolvedValue({
      endTime: new Date('2024-01-15T09:59:00Z'),
      externalId: 'existing-tag-id',
      id: 'db-id',
      source: 'manual',
      startTime: new Date('2024-01-15T09:00:00Z'),
      tag: 'computer:dharma',
    })
    vi.mocked(db.updateTagEndTime).mockResolvedValue(true)

    const result = await addTag('testuser', {
      mergeSpan: 180,
      startTime: new Date('2024-01-15T10:00:00Z'),
      tag: 'computer:dharma',
    })

    expect(result.success).toBe(true)
    expect(result.merged).toBe(true)
    expect(result.extendedBySeconds).toBe(60) // From 09:59:00 to 10:00:00
    expect(result.id).toBe('existing-tag-id')
    expect(result.startTime).toBe('2024-01-15T09:00:00.000Z') // Original start
    expect(result.endTime).toBe('2024-01-15T10:00:00.000Z') // New end

    expect(db.updateTagEndTime).toHaveBeenCalledWith(
      'testuser',
      'existing-tag-id',
      new Date('2024-01-15T10:00:00Z'),
    )
    expect(db.insertTag).not.toHaveBeenCalled()
  })

  test('extends tag with new end_time when both are provided', async () => {
    vi.mocked(db.findMergeableTag).mockResolvedValue({
      endTime: new Date('2024-01-15T09:59:00Z'),
      externalId: 'existing-tag-id',
      id: 'db-id',
      source: 'manual',
      startTime: new Date('2024-01-15T09:00:00Z'),
      tag: 'computer:dharma',
    })
    vi.mocked(db.updateTagEndTime).mockResolvedValue(true)

    const result = await addTag('testuser', {
      endTime: new Date('2024-01-15T10:01:00Z'),
      mergeSpan: 180,
      startTime: new Date('2024-01-15T10:00:00Z'),
      tag: 'computer:dharma',
    })

    expect(result.success).toBe(true)
    expect(result.merged).toBe(true)
    expect(result.extendedBySeconds).toBe(120) // From 09:59:00 to 10:01:00
    expect(result.endTime).toBe('2024-01-15T10:01:00.000Z')

    expect(db.updateTagEndTime).toHaveBeenCalledWith(
      'testuser',
      'existing-tag-id',
      new Date('2024-01-15T10:01:00Z'),
    )
  })

  test('merges with point-in-time tag (no end_time)', async () => {
    // Existing tag has no end_time - it's a point-in-time tag
    vi.mocked(db.findMergeableTag).mockResolvedValue({
      endTime: undefined,
      externalId: 'existing-tag-id',
      id: 'db-id',
      source: 'manual',
      startTime: new Date('2024-01-15T09:59:00Z'),
      tag: 'computer:dharma',
    })
    vi.mocked(db.updateTagEndTime).mockResolvedValue(true)

    const result = await addTag('testuser', {
      mergeSpan: 180,
      startTime: new Date('2024-01-15T10:00:00Z'),
      tag: 'computer:dharma',
    })

    expect(result.success).toBe(true)
    expect(result.merged).toBe(true)
    expect(result.extendedBySeconds).toBe(60) // From 09:59:00 (start) to 10:00:00 (new end)
    expect(result.startTime).toBe('2024-01-15T09:59:00.000Z')
    expect(result.endTime).toBe('2024-01-15T10:00:00.000Z')

    expect(db.updateTagEndTime).toHaveBeenCalledWith(
      'testuser',
      'existing-tag-id',
      new Date('2024-01-15T10:00:00Z'),
    )
  })
})

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
        source: 'manual',
        time: new Date('2024-01-15T08:00:00Z'),
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

describe('deleteTag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('deletes tag and returns success when found', async () => {
    vi.mocked(db.deleteTag).mockResolvedValue(true)

    const result = await deleteTag('testuser', 'tag-123')

    expect(result.success).toBe(true)
    expect(result.deleted).toBe(true)
    expect(result.externalId).toBe('tag-123')
    expect(db.deleteTag).toHaveBeenCalledWith('testuser', 'tag-123')
  })

  test('returns success false when tag not found', async () => {
    vi.mocked(db.deleteTag).mockResolvedValue(false)

    const result = await deleteTag('testuser', 'nonexistent-tag')

    expect(result.success).toBe(false)
    expect(result.deleted).toBe(false)
    expect(result.externalId).toBe('nonexistent-tag')
  })
})

describe('addActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('creates an exercise activity with required fields', async () => {
    vi.mocked(db.insertActivity).mockResolvedValue(undefined)

    const result = await addActivity('testuser', {
      activityType: 'exercise',
      endTime: new Date('2024-03-15T11:45:00Z'),
      startTime: new Date('2024-03-15T10:30:00Z'),
    })

    expect(result.success).toBe(true)
    expect(result.activityType).toBe('exercise')
    expect(result.startTime).toBe('2024-03-15T10:30:00.000Z')
    expect(result.endTime).toBe('2024-03-15T11:45:00.000Z')
    expect(result.id).toBeDefined()

    expect(db.insertActivity).toHaveBeenCalledWith('testuser', {
      activityType: 'exercise',
      data: undefined,
      endTime: new Date('2024-03-15T11:45:00Z'),
      id: expect.any(String),
      notes: undefined,
      source: 'manual',
      startTime: new Date('2024-03-15T10:30:00Z'),
      title: undefined,
    })
  })

  test('creates an activity with all fields', async () => {
    vi.mocked(db.insertActivity).mockResolvedValue(undefined)

    const result = await addActivity('testuser', {
      activityType: 'exercise',
      data: { exerciseType: 79 },
      endTime: new Date('2024-03-15T11:45:00Z'),
      notes: 'Dumbbell Bench Press: 12×30kg, 8×35kg',
      startTime: new Date('2024-03-15T10:30:00Z'),
      title: 'Upper body',
    })

    expect(result.success).toBe(true)
    expect(result.title).toBe('Upper body')
    expect(result.notes).toBe('Dumbbell Bench Press: 12×30kg, 8×35kg')
    expect(result.id).toBeDefined()

    expect(db.insertActivity).toHaveBeenCalledWith('testuser', {
      activityType: 'exercise',
      data: { exerciseType: 79 },
      endTime: new Date('2024-03-15T11:45:00Z'),
      id: expect.any(String),
      notes: 'Dumbbell Bench Press: 12×30kg, 8×35kg',
      source: 'manual',
      startTime: new Date('2024-03-15T10:30:00Z'),
      title: 'Upper body',
    })
  })

  test('returns error when endTime is before startTime', async () => {
    const result = await addActivity('testuser', {
      activityType: 'exercise',
      endTime: new Date('2024-03-15T09:00:00Z'),
      startTime: new Date('2024-03-15T10:30:00Z'),
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('end_time must be after start_time')
    expect(db.insertActivity).not.toHaveBeenCalled()
  })

  test('returns error when endTime equals startTime', async () => {
    const result = await addActivity('testuser', {
      activityType: 'exercise',
      endTime: new Date('2024-03-15T10:30:00Z'),
      startTime: new Date('2024-03-15T10:30:00Z'),
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('end_time must be after start_time')
    expect(db.insertActivity).not.toHaveBeenCalled()
  })

  test('creates meditation activity', async () => {
    vi.mocked(db.insertActivity).mockResolvedValue(undefined)

    const result = await addActivity('testuser', {
      activityType: 'meditation',
      endTime: new Date('2024-03-15T07:30:00Z'),
      startTime: new Date('2024-03-15T07:00:00Z'),
      title: 'Morning meditation',
    })

    expect(result.success).toBe(true)
    expect(result.activityType).toBe('meditation')

    expect(db.insertActivity).toHaveBeenCalledWith('testuser', {
      activityType: 'meditation',
      data: undefined,
      endTime: new Date('2024-03-15T07:30:00Z'),
      id: expect.any(String),
      notes: undefined,
      source: 'manual',
      startTime: new Date('2024-03-15T07:00:00Z'),
      title: 'Morning meditation',
    })
  })

  test('creates nap activity', async () => {
    vi.mocked(db.insertActivity).mockResolvedValue(undefined)

    const result = await addActivity('testuser', {
      activityType: 'nap',
      endTime: new Date('2024-03-15T14:30:00Z'),
      startTime: new Date('2024-03-15T14:00:00Z'),
    })

    expect(result.success).toBe(true)
    expect(result.activityType).toBe('nap')
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
      activityType: 'exercise',
      endTime: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'manual',
      startTime: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.updateActivity).mockResolvedValue({
      activityType: 'exercise',
      endTime: new Date('2024-03-15T12:00:00Z'),
      id: 'activity-123',
      source: 'manual',
      startTime: new Date('2024-03-15T09:00:00Z'),
    })

    const result = await updateActivity('testuser', 'activity-123', {
      endTime: new Date('2024-03-15T12:00:00Z'),
      startTime: new Date('2024-03-15T09:00:00Z'),
    })

    expect(result.success).toBe(true)
    expect(result.startTime).toBe('2024-03-15T09:00:00.000Z')
    expect(result.endTime).toBe('2024-03-15T12:00:00.000Z')
    expect(db.updateActivity).toHaveBeenCalledWith('testuser', 'activity-123', {
      endTime: new Date('2024-03-15T12:00:00Z'),
      notes: undefined,
      startTime: new Date('2024-03-15T09:00:00Z'),
      title: undefined,
    })
  })

  test('updates activity title and notes', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activityType: 'exercise',
      endTime: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'manual',
      startTime: new Date('2024-03-15T10:00:00Z'),
    })
    vi.mocked(db.updateActivity).mockResolvedValue({
      activityType: 'exercise',
      endTime: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      notes: 'Felt great!',
      source: 'manual',
      startTime: new Date('2024-03-15T10:00:00Z'),
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
      activityType: 'exercise',
      endTime: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'manual',
      startTime: new Date('2024-03-15T10:00:00Z'),
    })

    const result = await updateActivity('testuser', 'activity-123', {
      endTime: new Date('2024-03-15T09:00:00Z'), // Before existing start_time
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('end_time must be after start_time')
    expect(db.updateActivity).not.toHaveBeenCalled()
  })

  test('returns error when new start_time is after existing end_time', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activityType: 'exercise',
      endTime: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'manual',
      startTime: new Date('2024-03-15T10:00:00Z'),
    })

    const result = await updateActivity('testuser', 'activity-123', {
      startTime: new Date('2024-03-15T12:00:00Z'), // After existing end_time
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('end_time must be after start_time')
    expect(db.updateActivity).not.toHaveBeenCalled()
  })

  test('validates both new start and end times together', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue({
      activityType: 'exercise',
      endTime: new Date('2024-03-15T11:00:00Z'),
      id: 'activity-123',
      source: 'manual',
      startTime: new Date('2024-03-15T10:00:00Z'),
    })

    const result = await updateActivity('testuser', 'activity-123', {
      endTime: new Date('2024-03-15T08:00:00Z'),
      startTime: new Date('2024-03-15T09:00:00Z'), // end_time before start_time
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('end_time must be after start_time')
    expect(db.updateActivity).not.toHaveBeenCalled()
  })
})
