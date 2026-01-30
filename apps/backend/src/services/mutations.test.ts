import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as db from '../db'
import { addMetric, addTag, deleteTag } from './mutations'

// Mock the db module
vi.mock('../db', () => ({
  deleteTag: vi.fn(),
  findMergeableTag: vi.fn(),
  insertTag: vi.fn(),
  insertTimeSeries: vi.fn(),
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
