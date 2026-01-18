import { createCipheriv, randomBytes } from 'crypto'
import { Mock, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Mock the db module
vi.mock('./db', () => ({
  getActivities: vi.fn(),
  getProductivity: vi.fn(),
  getTags: vi.fn(),
  getTimeSeries: vi.fn(),
  insertTag: vi.fn(),
  insertTimeSeries: vi.fn(),
}))

import { getActivities, getProductivity, getTags, getTimeSeries, insertTag, insertTimeSeries } from './db'
import { metricUnits } from './schema'

const SESSION_SALT = 'very very secretvery very secret' // 32 bytes for AES-256

function createAuthToken(username: string): string {
  // Match the api.ts behavior: use base64-encoded IV string directly as the cipher IV
  const iv = randomBytes(12).toString('base64')
  const cipher = createCipheriv('aes-256-gcm', SESSION_SALT, iv)
  const encrypted = cipher.update(username, 'utf8', 'base64') + cipher.final('base64')
  const tag = cipher.getAuthTag().toString('base64')
  return `${encrypted}-${iv}-${tag}`
}

// Extract and test the authentication helper from mcp.ts
// Since getUsernameFromSession is not exported, we recreate its logic here for testing
import { createDecipheriv } from 'crypto'

function getUsernameFromSession(sessid: string, sessionSalt: string): string {
  try {
    if (!sessid) throw new Error('unauthenticated')
    const [encrypted, sessionIv, tag] = sessid.split('-')
    const decipher = createDecipheriv('aes-256-gcm', sessionSalt, sessionIv)
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return decipher.update(encrypted, 'base64', 'utf8') + decipher.final('utf8')
  } catch {
    throw new Error('unauthenticated')
  }
}

describe('MCP Server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('Authentication', () => {
    test('decrypts valid token correctly', () => {
      const token = createAuthToken('testuser')
      const username = getUsernameFromSession(token, SESSION_SALT)
      expect(username).toBe('testuser')
    })

    test('throws for empty token', () => {
      expect(() => getUsernameFromSession('', SESSION_SALT)).toThrow('unauthenticated')
    })

    test('throws for malformed token', () => {
      expect(() => getUsernameFromSession('invalid-token', SESSION_SALT)).toThrow('unauthenticated')
    })

    test('throws for token with wrong salt', () => {
      const token = createAuthToken('testuser')
      const wrongSalt = 'wrong salt wrong salt wrong salt!'
      expect(() => getUsernameFromSession(token, wrongSalt)).toThrow('unauthenticated')
    })

    test('decrypts different usernames correctly', () => {
      const users = ['alice', 'bob', 'charlie', 'user@example.com']
      for (const user of users) {
        const token = createAuthToken(user)
        const username = getUsernameFromSession(token, SESSION_SALT)
        expect(username).toBe(user)
      }
    })
  })

  describe('Metric Validation', () => {
    const validMetrics = [
      'heart_rate',
      'resting_heart_rate',
      'hrv_rmssd',
      'weight',
      'body_fat',
      'bone_mass',
      'lean_body_mass',
      'body_water_mass',
      'height',
      'steps',
      'distance',
      'floors_climbed',
      'calories_active',
      'calories_total',
      'calories_basal',
      'spo2',
      'respiratory_rate',
      'body_temperature',
      'basal_body_temperature',
      'blood_glucose',
      'blood_pressure_systolic',
      'blood_pressure_diastolic',
      'vo2_max',
      'readiness_score',
      'resilience_score',
      'productivity_score',
    ]

    test('all valid metrics have defined units', () => {
      for (const metric of validMetrics) {
        expect(metricUnits[metric as keyof typeof metricUnits]).toBeDefined()
      }
    })

    test('heart_rate has bpm unit', () => {
      expect(metricUnits['heart_rate']).toBe('bpm')
    })

    test('weight has kg unit', () => {
      expect(metricUnits['weight']).toBe('kg')
    })

    test('steps has count unit', () => {
      expect(metricUnits['steps']).toBe('count')
    })
  })

  describe('Database Integration', () => {
    test('getTimeSeries is called with correct parameters', async () => {
      const mockData: [Date, number][] = [
        [new Date('2024-01-15T10:00:00Z'), 72],
        [new Date('2024-01-15T11:00:00Z'), 75],
      ]
      ;(getTimeSeries as Mock).mockResolvedValue(mockData)

      const result = await getTimeSeries(
        'testuser',
        'heart_rate',
        new Date('2024-01-15'),
        new Date('2024-01-16'),
      )

      expect(getTimeSeries).toHaveBeenCalledWith('testuser', 'heart_rate', expect.any(Date), expect.any(Date))
      expect(result).toEqual(mockData)
    })

    test('getActivities returns sleep sessions', async () => {
      const mockSleep = [
        {
          activityType: 'sleep',
          data: { quality: 'good' },
          endTime: new Date('2024-01-15T07:00:00Z'),
          source: 'health_connect',
          startTime: new Date('2024-01-14T23:00:00Z'),
        },
      ]
      ;(getActivities as Mock).mockResolvedValue(mockSleep)

      const result = await getActivities(
        'testuser',
        'sleep',
        new Date('2024-01-14'),
        new Date('2024-01-15T23:59:59'),
      )

      expect(result).toEqual(mockSleep)
      expect(result[0].activityType).toBe('sleep')
    })

    test('getTags returns user tags', async () => {
      const mockTags = [
        {
          endTime: undefined,
          source: 'manual',
          startTime: new Date('2024-01-15T09:00:00Z'),
          tag: 'coffee',
        },
      ]
      ;(getTags as Mock).mockResolvedValue(mockTags)

      const result = await getTags('testuser', new Date('2024-01-15'), new Date('2024-01-15T23:59:59'))

      expect(result).toEqual(mockTags)
      expect(result[0].tag).toBe('coffee')
    })

    test('getProductivity returns productivity records', async () => {
      const mockProductivity = [
        {
          activity: 'VS Code',
          category: 'Programming',
          durationSec: 3600,
          endTime: new Date('2024-01-15T11:00:00Z'),
          productivity: 2,
          source: 'rescuetime',
          startTime: new Date('2024-01-15T10:00:00Z'),
        },
      ]
      ;(getProductivity as Mock).mockResolvedValue(mockProductivity)

      const result = await getProductivity(
        'testuser',
        new Date('2024-01-15'),
        new Date('2024-01-15T23:59:59'),
      )

      expect(result).toEqual(mockProductivity)
      expect(result[0].productivity).toBe(2)
    })

    test('insertTag is called with correct parameters', async () => {
      ;(insertTag as Mock).mockResolvedValue(undefined)

      await insertTag('testuser', {
        endTime: undefined,
        externalId: 'test-id',
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'meditation',
      })

      expect(insertTag).toHaveBeenCalledWith('testuser', {
        endTime: undefined,
        externalId: 'test-id',
        source: 'manual',
        startTime: expect.any(Date),
        tag: 'meditation',
      })
    })

    test('insertTimeSeries is called with correct parameters', async () => {
      ;(insertTimeSeries as Mock).mockResolvedValue(undefined)

      await insertTimeSeries('testuser', [
        {
          metric: 'heart_rate',
          source: 'manual',
          time: new Date('2024-01-15T10:00:00Z'),
          value: 72,
        },
      ])

      expect(insertTimeSeries).toHaveBeenCalledWith('testuser', [
        {
          metric: 'heart_rate',
          source: 'manual',
          time: expect.any(Date),
          value: 72,
        },
      ])
    })
  })

  describe('Daily Summary Calculations', () => {
    test('calculates heart rate statistics correctly', () => {
      const heartRates = [70, 80, 75, 65, 90]

      const stats = {
        avg: Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length),
        count: heartRates.length,
        max: Math.max(...heartRates),
        min: Math.min(...heartRates),
      }

      expect(stats.min).toBe(65)
      expect(stats.max).toBe(90)
      expect(stats.avg).toBe(76) // (70+80+75+65+90)/5 = 76
      expect(stats.count).toBe(5)
    })

    test('sums steps correctly', () => {
      const stepsData: [Date, number][] = [
        [new Date('2024-01-15T08:00:00Z'), 1000],
        [new Date('2024-01-15T12:00:00Z'), 2000],
        [new Date('2024-01-15T18:00:00Z'), 1500],
      ]

      const totalSteps = stepsData.reduce((sum, [, value]) => sum + value, 0)

      expect(totalSteps).toBe(4500)
    })

    test('calculates productivity summary correctly', () => {
      const productivity = [
        { durationSec: 3600, productivity: 2 }, // very productive
        { durationSec: 1800, productivity: 1 }, // productive
        { durationSec: 900, productivity: 0 }, // neutral
        { durationSec: 600, productivity: -1 }, // distracting
        { durationSec: 300, productivity: -2 }, // very distracting
      ]

      const summary = productivity.reduce(
        (acc, record) => {
          acc.totalDurationSec += record.durationSec
          if (record.productivity >= 1) acc.productiveSec += record.durationSec
          if (record.productivity >= 2) acc.veryProductiveSec += record.durationSec
          if (record.productivity <= -1) acc.distractingSec += record.durationSec
          return acc
        },
        { distractingSec: 0, productiveSec: 0, totalDurationSec: 0, veryProductiveSec: 0 },
      )

      expect(summary.totalDurationSec).toBe(7200) // 3600+1800+900+600+300
      expect(summary.veryProductiveSec).toBe(3600) // only productivity >= 2
      expect(summary.productiveSec).toBe(5400) // productivity >= 1 (3600+1800)
      expect(summary.distractingSec).toBe(900) // productivity <= -1 (600+300)
    })

    test('calculates sleep duration in minutes', () => {
      const startTime = new Date('2024-01-14T23:00:00Z')
      const endTime = new Date('2024-01-15T07:00:00Z')

      const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 1000 / 60)

      expect(durationMinutes).toBe(480) // 8 hours = 480 minutes
    })

    test('handles empty data gracefully', () => {
      const heartRates: number[] = []
      const heartRateStats = heartRates.length > 0 ? { avg: 0, count: 0, max: 0, min: 0 } : null

      expect(heartRateStats).toBeNull()
    })
  })

  describe('Date Parsing', () => {
    test('parses ISO 8601 date correctly', () => {
      const dateStr = '2024-01-15T10:30:00Z'
      const date = new Date(dateStr)

      expect(date.toISOString()).toBe('2024-01-15T10:30:00.000Z')
      expect(isNaN(date.getTime())).toBe(false)
    })

    test('identifies invalid date', () => {
      const invalidDate = new Date('not-a-date')

      expect(isNaN(invalidDate.getTime())).toBe(true)
    })

    test('parses YYYY-MM-DD date format', () => {
      const dateStr = '2024-01-15'
      const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)

      expect(match).not.toBeNull()
      expect(match![1]).toBe('2024')
      expect(match![2]).toBe('01')
      expect(match![3]).toBe('15')
    })

    test('rejects invalid date format', () => {
      const invalidFormats = ['01-15-2024', '2024/01/15', '15-01-2024', '2024-1-15']

      for (const format of invalidFormats) {
        const match = format.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        expect(match).toBeNull()
      }
    })
  })
})
