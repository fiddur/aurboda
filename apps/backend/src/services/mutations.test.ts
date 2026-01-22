import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as db from '../db'
import { addMetric, addTag } from './mutations'

// Mock the db module
vi.mock('../db', () => ({
  insertTag: vi.fn(),
  insertTimeSeries: vi.fn(),
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
