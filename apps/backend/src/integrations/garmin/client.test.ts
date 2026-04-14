/**
 * Garmin Connect API client tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the GarminConnect class from the library
const mockGarminConnect = vi.hoisted(() => ({
  exportToken: vi.fn().mockReturnValue({ oauth1: 'token1', oauth2: 'token2' }),
  get: vi.fn().mockResolvedValue({}),
  getActivities: vi.fn().mockResolvedValue([]),
  getHeartRate: vi.fn().mockResolvedValue({}),
  getSleepData: vi.fn().mockResolvedValue({}),
  getUserProfile: vi.fn().mockResolvedValue({ displayName: 'user123' }),
  getUserSettings: vi.fn().mockResolvedValue({ userData: {} }),
  loadToken: vi.fn(),
  login: vi.fn().mockResolvedValue({ type: 'success' }),
  verifyMfa: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@flow-js/garmin-connect', () => {
  const MockGarminConnect = vi.fn()
  Object.assign(MockGarminConnect.prototype, mockGarminConnect)
  return {
    default: { GarminConnect: MockGarminConnect },
    GarminConnect: MockGarminConnect,
  }
})

import garminConnectPkg from '@flow-js/garmin-connect'
const { GarminConnect } = garminConnectPkg

import { garminClient, type GarminClientDeps } from './client.ts'

const testUser = 'test-user'
const storedTokens = { oauth1: 'stored-token1', oauth2: 'stored-token2' }

const createMockDeps = (): GarminClientDeps => ({
  getOAuthToken: vi.fn().mockResolvedValue({
    access_token: JSON.stringify(storedTokens),
    provider: 'garmin',
  }),
  upsertOAuthToken: vi.fn().mockResolvedValue(undefined),
})

describe('garminClient', () => {
  let deps: GarminClientDeps

  beforeEach(() => {
    vi.clearAllMocks()
    deps = createMockDeps()
  })

  describe('login', () => {
    it('creates GarminConnect with credentials and logs in', async () => {
      const client = garminClient(deps)
      const result = await client.login(testUser, 'user@example.com', 'secret')

      expect(GarminConnect).toHaveBeenCalledWith({
        password: 'secret',
        username: 'user@example.com',
      })
      expect(mockGarminConnect.login).toHaveBeenCalled()
      expect(result).toEqual({
        success: true,
        tokens: { oauth1: 'token1', oauth2: 'token2' },
      })
    })

    it('stores tokens after successful login', async () => {
      const client = garminClient(deps)
      await client.login(testUser, 'user@example.com', 'secret')

      expect(deps.upsertOAuthToken).toHaveBeenCalledWith(testUser, {
        access_token: JSON.stringify({ oauth1: 'token1', oauth2: 'token2' }),
        provider: 'garmin',
      })
    })

    it('returns mfa_required when Garmin requires MFA', async () => {
      mockGarminConnect.login.mockResolvedValueOnce({
        type: 'mfa_required',
        loginParams: { clientId: 'test' },
      })

      const client = garminClient(deps)
      const result = await client.login(testUser, 'user@example.com', 'secret')

      expect(result).toEqual({ mfa_required: true })
      expect(deps.upsertOAuthToken).not.toHaveBeenCalled()
    })
  })

  describe('verifyMfa', () => {
    it('completes login after MFA verification', async () => {
      mockGarminConnect.login.mockResolvedValueOnce({
        type: 'mfa_required',
        loginParams: { clientId: 'test' },
      })

      const client = garminClient(deps)
      await client.login(testUser, 'user@example.com', 'secret')

      const result = await client.verifyMfa(testUser, '123456')

      expect(mockGarminConnect.verifyMfa).toHaveBeenCalledWith('123456')
      expect(result).toEqual({
        success: true,
        tokens: { oauth1: 'token1', oauth2: 'token2' },
      })
      expect(deps.upsertOAuthToken).toHaveBeenCalledWith(testUser, {
        access_token: JSON.stringify({ oauth1: 'token1', oauth2: 'token2' }),
        provider: 'garmin',
      })
    })

    it('throws when no pending MFA session exists', async () => {
      const client = garminClient(deps)
      await expect(client.verifyMfa(testUser, '123456')).rejects.toThrow('No pending MFA session')
    })
  })

  describe('disconnect', () => {
    it('clears stored tokens', async () => {
      const client = garminClient(deps)
      await client.disconnect(testUser)

      expect(deps.upsertOAuthToken).toHaveBeenCalledWith(testUser, {
        access_token: '',
        provider: 'garmin',
      })
    })
  })

  describe('restoreSession (via data methods)', () => {
    it('throws when no token is stored', async () => {
      vi.mocked(deps.getOAuthToken).mockResolvedValue(null)

      const client = garminClient(deps)
      await expect(client.getHeartRate(testUser, new Date())).rejects.toThrow(
        'User has no Garmin session. Please connect Garmin first.',
      )
    })

    it('loads stored tokens into GarminConnect', async () => {
      const client = garminClient(deps)
      await client.getHeartRate(testUser, new Date('2024-06-15'))

      expect(deps.getOAuthToken).toHaveBeenCalledWith(testUser, 'garmin')
      expect(mockGarminConnect.loadToken).toHaveBeenCalledWith('stored-token1', 'stored-token2')
    })
  })

  describe('getDailySummary', () => {
    it('restores session, fetches summary via get, and saves session', async () => {
      const summaryData = { calendarDate: '2024-06-15', totalSteps: 10000 }
      mockGarminConnect.get.mockResolvedValueOnce(summaryData)

      const client = garminClient(deps)
      const result = await client.getDailySummary(testUser, new Date('2024-06-15'))

      expect(deps.getOAuthToken).toHaveBeenCalledWith(testUser, 'garmin')
      expect(mockGarminConnect.loadToken).toHaveBeenCalledWith('stored-token1', 'stored-token2')
      expect(mockGarminConnect.getUserProfile).toHaveBeenCalled()
      expect(mockGarminConnect.get).toHaveBeenCalledWith(
        'https://connectapi.garmin.com/usersummary-service/usersummary/daily/user123?calendarDate=2024-06-15',
      )
      expect(result).toEqual(summaryData)
      expect(deps.upsertOAuthToken).toHaveBeenCalledWith(testUser, {
        access_token: JSON.stringify({ oauth1: 'token1', oauth2: 'token2' }),
        provider: 'garmin',
      })
    })
  })

  describe('getHeartRate', () => {
    it('restores session, calls getHeartRate, and saves session', async () => {
      const hrData = { heartRateValues: [[1000, 72]] }
      mockGarminConnect.getHeartRate.mockResolvedValueOnce(hrData)

      const client = garminClient(deps)
      const date = new Date('2024-06-15')
      const result = await client.getHeartRate(testUser, date)

      expect(deps.getOAuthToken).toHaveBeenCalledWith(testUser, 'garmin')
      expect(mockGarminConnect.loadToken).toHaveBeenCalledWith('stored-token1', 'stored-token2')
      expect(mockGarminConnect.getHeartRate).toHaveBeenCalledWith(date)
      expect(result).toEqual(hrData)
      expect(deps.upsertOAuthToken).toHaveBeenCalledWith(testUser, {
        access_token: JSON.stringify({ oauth1: 'token1', oauth2: 'token2' }),
        provider: 'garmin',
      })
    })
  })

  describe('getStress', () => {
    it('restores session, fetches stress via get, and saves session', async () => {
      const stressData = { calendarDate: '2024-06-15', overallStressLevel: 42 }
      mockGarminConnect.get.mockResolvedValueOnce(stressData)

      const client = garminClient(deps)
      const result = await client.getStress(testUser, new Date('2024-06-15'))

      expect(deps.getOAuthToken).toHaveBeenCalledWith(testUser, 'garmin')
      expect(mockGarminConnect.loadToken).toHaveBeenCalledWith('stored-token1', 'stored-token2')
      expect(mockGarminConnect.get).toHaveBeenCalledWith(
        'https://connectapi.garmin.com/wellness-service/wellness/dailyStress/2024-06-15',
      )
      expect(result).toEqual(stressData)
      expect(deps.upsertOAuthToken).toHaveBeenCalledWith(testUser, {
        access_token: JSON.stringify({ oauth1: 'token1', oauth2: 'token2' }),
        provider: 'garmin',
      })
    })
  })

  describe('getHrv', () => {
    it('restores session, fetches HRV via get, and saves session', async () => {
      const hrvData = {
        calendarDate: '2024-06-15',
        lastNightAvg: 42,
        weeklyAvg: 45,
      }
      mockGarminConnect.get.mockResolvedValueOnce(hrvData)

      const client = garminClient(deps)
      const result = await client.getHrv(testUser, new Date('2024-06-15'))

      expect(mockGarminConnect.get).toHaveBeenCalledWith(
        'https://connectapi.garmin.com/hrv-service/hrv/2024-06-15',
      )
      expect(result).toEqual(hrvData)
      expect(deps.upsertOAuthToken).toHaveBeenCalled()
    })
  })

  describe('getSleep', () => {
    it('restores session, calls getSleepData, and saves session', async () => {
      const sleepData = { dailySleepDTO: { calendarDate: '2024-06-15' } }
      mockGarminConnect.getSleepData.mockResolvedValueOnce(sleepData)

      const client = garminClient(deps)
      const date = new Date('2024-06-15')
      const result = await client.getSleep(testUser, date)

      expect(mockGarminConnect.getSleepData).toHaveBeenCalledWith(date)
      expect(result).toEqual(sleepData)
      expect(deps.upsertOAuthToken).toHaveBeenCalled()
    })
  })

  describe('getBodyBattery', () => {
    it('restores session, fetches body battery with date range, and saves session', async () => {
      const bbData = [{ charged: 80, date: '2024-06-15', drained: 60 }]
      mockGarminConnect.get.mockResolvedValueOnce(bbData)

      const client = garminClient(deps)
      const result = await client.getBodyBattery(testUser, new Date('2024-06-14'), new Date('2024-06-15'))

      expect(mockGarminConnect.get).toHaveBeenCalledWith(
        'https://connectapi.garmin.com/wellness-service/wellness/bodyBattery/reports/daily?startDate=2024-06-14&endDate=2024-06-15',
      )
      expect(result).toEqual(bbData)
      expect(deps.upsertOAuthToken).toHaveBeenCalled()
    })
  })

  describe('getActivities', () => {
    it('restores session, calls getActivities with start and limit, and saves session', async () => {
      const activities = [{ activityId: 1 }, { activityId: 2 }]
      mockGarminConnect.getActivities.mockResolvedValueOnce(activities)

      const client = garminClient(deps)
      const result = await client.getActivities(testUser, 0, 10)

      expect(mockGarminConnect.getActivities).toHaveBeenCalledWith(0, 10)
      expect(result).toEqual(activities)
      expect(deps.upsertOAuthToken).toHaveBeenCalled()
    })
  })

  describe('getSpo2', () => {
    it('restores session, fetches SpO2 via get, and saves session', async () => {
      const spo2Data = { averageSpO2: 97, calendarDate: '2024-06-15' }
      mockGarminConnect.get.mockResolvedValueOnce(spo2Data)

      const client = garminClient(deps)
      const result = await client.getSpo2(testUser, new Date('2024-06-15'))

      expect(mockGarminConnect.get).toHaveBeenCalledWith(
        'https://connectapi.garmin.com/wellness-service/wellness/daily/spo2/2024-06-15',
      )
      expect(result).toEqual(spo2Data)
      expect(deps.upsertOAuthToken).toHaveBeenCalled()
    })
  })

  describe('getRespiration', () => {
    it('restores session, fetches respiration via get, and saves session', async () => {
      const respData = {
        avgWakingRespirationValue: 16,
        calendarDate: '2024-06-15',
      }
      mockGarminConnect.get.mockResolvedValueOnce(respData)

      const client = garminClient(deps)
      const result = await client.getRespiration(testUser, new Date('2024-06-15'))

      expect(mockGarminConnect.get).toHaveBeenCalledWith(
        'https://connectapi.garmin.com/wellness-service/wellness/daily/respiration/2024-06-15',
      )
      expect(result).toEqual(respData)
      expect(deps.upsertOAuthToken).toHaveBeenCalled()
    })
  })

  describe('getTrainingReadiness', () => {
    it('restores session, fetches training readiness via get, and saves session', async () => {
      const trData = {
        calendarDate: '2024-06-15',
        level: 'HIGH',
        overallScore: 75,
      }
      mockGarminConnect.get.mockResolvedValueOnce(trData)

      const client = garminClient(deps)
      const result = await client.getTrainingReadiness(testUser, new Date('2024-06-15'))

      expect(mockGarminConnect.get).toHaveBeenCalledWith(
        'https://connectapi.garmin.com/metrics-service/metrics/trainingreadiness/2024-06-15',
      )
      expect(result).toEqual(trData)
      expect(deps.upsertOAuthToken).toHaveBeenCalled()
    })
  })

  describe('getIntensityMinutes', () => {
    it('restores session, fetches intensity minutes via get, and saves session', async () => {
      const imData = {
        calendarDate: '2024-06-15',
        moderateIntensityMinutes: 30,
        vigorousIntensityMinutes: 15,
      }
      mockGarminConnect.get.mockResolvedValueOnce(imData)

      const client = garminClient(deps)
      const result = await client.getIntensityMinutes(testUser, new Date('2024-06-15'))

      expect(mockGarminConnect.get).toHaveBeenCalledWith(
        'https://connectapi.garmin.com/wellness-service/wellness/daily/im/2024-06-15',
      )
      expect(result).toEqual(imData)
      expect(deps.upsertOAuthToken).toHaveBeenCalled()
    })
  })
})
