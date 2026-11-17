import { describe, expect, test, vi } from 'vitest'

import type { GarminProcessDeps } from './process.ts'

import { processGarminData } from './process.ts'
import { adaptGarminPushItem, garminPushFeeds, offsetSamples, pushCalendarDate } from './push-adapters.ts'

// 2025-01-15T00:00:00Z
const DAY_START = 1736899200

const recordingDeps = () => {
  const deps = {
    activityTypeExists: vi.fn(async () => true),
    adoptLegacyActivity: vi.fn(async () => null),
    auditError: vi.fn(),
    auditInfo: vi.fn(),
    auditWarn: vi.fn(),
    deleteGarminActivityWithWrongType: vi.fn(),
    insertActivity: vi.fn(),
    insertLocations: vi.fn(),
    insertRawRecord: vi.fn(),
    insertTimeSeries: vi.fn(),
    softDeleteSupersededLocations: vi.fn(async () => 0),
    upsertActivityTrack: vi.fn(),
  }
  return deps as typeof deps & GarminProcessDeps
}

const runThroughProcessors = async (type: string, item: unknown) => {
  const deps = recordingDeps()
  const adapted = adaptGarminPushItem(type, item)
  for (const { data, dataType } of adapted.garmin) await processGarminData('alice', dataType, data, deps)
  return {
    activities: deps.insertActivity.mock.calls.map((call) => call[1]),
    adapted,
    deps,
    points: deps.insertTimeSeries.mock.calls.flatMap((call) => call[1]),
  }
}

const garbled = [null, 'x', 42, [], {}, { calendarDate: 7, startTimeInSeconds: 'soon' }]

describe('pushCalendarDate', () => {
  test('uses calendarDate when it is a date', () => {
    expect(pushCalendarDate({ calendarDate: '2025-01-15', startTimeInSeconds: DAY_START })).toBe('2025-01-15')
  })

  test('derives the local day from start + offset when calendarDate is missing', () => {
    // 23:00 UTC on the 14th is the 15th at UTC+2
    expect(pushCalendarDate({ startTimeInSeconds: DAY_START - 3600, startTimeOffsetInSeconds: 7200 })).toBe(
      '2025-01-15',
    )
    expect(pushCalendarDate({ startTimeInSeconds: DAY_START - 3600 })).toBe('2025-01-14')
  })

  test('ignores a calendarDate that is not a date', () => {
    expect(pushCalendarDate({ calendarDate: '2025-02-30' })).toBeUndefined()
    expect(pushCalendarDate({ calendarDate: 'yesterday' })).toBeUndefined()
  })
})

describe('offsetSamples', () => {
  test('turns offsets into epoch milliseconds in time order, dropping non-numbers', () => {
    expect(offsetSamples({ '0': 60, '120': 'x', '60': 62, x: 70 }, DAY_START)).toEqual([
      [DAY_START * 1000, 60],
      [(DAY_START + 60) * 1000, 62],
    ])
  })

  test('answers nothing without a start or a map', () => {
    expect(offsetSamples({ '0': 60 }, undefined)).toEqual([])
    expect(offsetSamples([60], DAY_START)).toEqual([])
  })
})

describe('garminPushFeeds', () => {
  test('names the pull types a summary type fills', () => {
    expect(garminPushFeeds('dailies')).toEqual(['dailySummary', 'heartRate', 'intensityMinutes'])
    expect(garminPushFeeds('pulseox')).toEqual(['spo2'])
    expect(garminPushFeeds('epochs')).toEqual([])
    expect(garminPushFeeds('somethingNew')).toEqual([])
    expect(garminPushFeeds('constructor')).toEqual([])
  })
})

describe('dailies', () => {
  const daily = {
    activeKilocalories: 500,
    averageSpo2: 96,
    averageStressLevel: 30,
    bmrKilocalories: 1700,
    calendarDate: '2025-01-15',
    distanceInMeters: 8000.5,
    floorsClimbed: 12,
    moderateIntensityDurationInSeconds: 1250,
    restingHeartRateInBeatsPerMinute: 52,
    startTimeInSeconds: DAY_START,
    steps: 10234,
    summaryId: 'x-1',
    timeOffsetHeartRateSamples: { '0': 58, '15': 0, '30': 60 },
    vigorousIntensityDurationInSeconds: 600,
  }

  test('writes the same daily points the pull writes', async () => {
    const { points } = await runThroughProcessors('dailies', daily)
    const noon = new Date('2025-01-15T12:00:00Z')
    expect(points).toEqual(
      expect.arrayContaining([
        { metric: 'steps', source: 'garmin', time: noon, unit: 'count', value: 10234 },
        { metric: 'distance', source: 'garmin', time: noon, unit: 'm', value: 8000.5 },
        { metric: 'floors_climbed', source: 'garmin', time: noon, unit: 'count', value: 12 },
        { metric: 'calories_active', source: 'garmin', time: noon, unit: 'kcal', value: 500 },
        { metric: 'calories_total', source: 'garmin', time: noon, unit: 'kcal', value: 2200 },
        { metric: 'resting_heart_rate', source: 'garmin', time: noon, unit: 'bpm', value: 52 },
        { metric: 'stress_level', source: 'garmin', time: noon, unit: 'score', value: 30 },
        { metric: 'spo2', source: 'garmin', time: noon, unit: 'percent', value: 96 },
      ]),
    )
  })

  test('turns heart rate offsets into samples at their own times, zeros dropped', async () => {
    const { points } = await runThroughProcessors('dailies', daily)
    expect(points.filter((p) => p.metric === 'heart_rate')).toEqual([
      { metric: 'heart_rate', source: 'garmin', time: new Date(DAY_START * 1000), unit: 'bpm', value: 58 },
      {
        metric: 'heart_rate',
        source: 'garmin',
        time: new Date((DAY_START + 30) * 1000),
        unit: 'bpm',
        value: 60,
      },
    ])
  })

  test('rounds intensity durations to minutes, vigorous counted twice by the processor', async () => {
    const { adapted, points } = await runThroughProcessors('dailies', daily)
    expect(adapted.garmin.find((g) => g.dataType === 'intensityMinutes')?.data).toEqual({
      calendarDate: '2025-01-15',
      moderateMinutes: 21,
      vigorousMinutes: 10,
    })
    expect(points.find((p) => p.metric === 'intensity_minutes')?.value).toBe(41)
  })

  test('leaves calories_total out when bmr is missing', async () => {
    const { points } = await runThroughProcessors('dailies', { ...daily, bmrKilocalories: undefined })
    expect(points.some((p) => p.metric === 'calories_total')).toBe(false)
  })

  test('omits heart rate and intensity minutes when their fields are absent', () => {
    const { garmin } = adaptGarminPushItem('dailies', { calendarDate: '2025-01-15', steps: 5 })
    expect(garmin.map((g) => g.dataType)).toEqual(['dailySummary'])
  })

  test('derives the date from start + offset', () => {
    const { garmin } = adaptGarminPushItem('dailies', {
      startTimeInSeconds: DAY_START - 3600,
      startTimeOffsetInSeconds: 7200,
      steps: 5,
    })
    expect((garmin[0]!.data as { calendarDate: string }).calendarDate).toBe('2025-01-15')
  })

  test.each(garbled)('answers nothing for %j', async (item) => {
    const { points } = await runThroughProcessors('dailies', item)
    expect(points).toEqual([])
  })

  test('a field of the wrong type gives no point and no throw', async () => {
    const { points } = await runThroughProcessors('dailies', { calendarDate: '2025-01-15', steps: '10000' })
    expect(points).toEqual([])
  })
})

describe('sleeps', () => {
  const sleepStart = DAY_START - 2 * 3600 // 22:00 UTC on the 14th
  const sleep = {
    awakeDurationInSeconds: 600,
    calendarDate: '2025-01-15',
    deepSleepDurationInSeconds: 5400,
    durationInSeconds: 27000,
    lightSleepDurationInSeconds: 14400,
    naps: [{ napDurationInSeconds: 1800, napStartTimeInSeconds: DAY_START + 12 * 3600 + 17 * 60 + 46 }],
    overallSleepScore: { qualifierKey: 'GOOD', value: 82 },
    remSleepInSeconds: 7200,
    sleepLevelsMap: {
      awake: [{ endTimeInSeconds: sleepStart + 28200, startTimeInSeconds: sleepStart + 27600 }],
      deep: [{ endTimeInSeconds: sleepStart + 5400, startTimeInSeconds: sleepStart }],
      light: [{ endTimeInSeconds: sleepStart + 19800, startTimeInSeconds: sleepStart + 5400 }],
      rem: [{ endTimeInSeconds: sleepStart + 27600, startTimeInSeconds: sleepStart + 19800 }],
      unknownLevel: [{ endTimeInSeconds: sleepStart + 10, startTimeInSeconds: sleepStart }],
    },
    startTimeInSeconds: sleepStart,
    summaryId: 'x-sleep',
    validation: 'AUTO_TENTATIVE',
  }

  test('writes the sleep under the pull external id with stages in time order', async () => {
    const { activities } = await runThroughProcessors('sleeps', sleep)
    const night = activities.find((a) => a.activity_type === 'sleep')!
    expect(night.external_id).toBe('garmin-sleep-2025-01-15')
    expect(night.start_time).toEqual(new Date(sleepStart * 1000))
    expect(night.data).toMatchObject({
      awake_seconds: 600,
      deep_sleep_seconds: 5400,
      light_sleep_seconds: 14400,
      rem_sleep_seconds: 7200,
      sleep_score: 82,
    })
    expect((night.data!.stages as { stage: number }[]).map((s) => s.stage)).toEqual([5, 4, 6, 1])
  })

  test('takes the end from the latest level when there are levels, beyond start + duration', async () => {
    const { activities } = await runThroughProcessors('sleeps', sleep)
    expect(activities.find((a) => a.activity_type === 'sleep')!.end_time).toEqual(
      new Date((sleepStart + 28200) * 1000),
    )
  })

  test('falls back to start + duration without levels', async () => {
    const { activities } = await runThroughProcessors('sleeps', { ...sleep, sleepLevelsMap: undefined })
    const night = activities.find((a) => a.activity_type === 'sleep')!
    expect(night.end_time).toEqual(new Date((sleepStart + 27000) * 1000))
    expect(night.data).not.toHaveProperty('stages')
  })

  test('maps the levels to the four Garmin activity levels', () => {
    const { garmin } = adaptGarminPushItem('sleeps', sleep)
    const levels = (garmin[0]!.data as { sleepLevels: { activityLevel: number; startGMT: string }[] })
      .sleepLevels
    expect(levels.map((l) => l.activityLevel)).toEqual([0, 1, 2, 3])
    expect(levels[0]!.startGMT).toBe(new Date(sleepStart * 1000).toISOString())
  })

  test('writes naps with the pull id format', async () => {
    const { activities } = await runThroughProcessors('sleeps', sleep)
    const nap = activities.find((a) => a.activity_type === 'nap')!
    expect(nap.external_id).toBe('garmin-nap-2025-01-15T12:17:46')
    expect(nap.end_time!.getTime() - nap.start_time.getTime()).toBe(1800 * 1000)
  })

  test('writes the sleep score at noon of the calendar date', async () => {
    const { points } = await runThroughProcessors('sleeps', sleep)
    expect(points).toEqual([
      {
        metric: 'sleep_score',
        source: 'garmin',
        time: new Date('2025-01-15T12:00:00Z'),
        unit: 'score',
        value: 82,
      },
    ])
  })

  test('uses the UTC date of the end without a calendarDate', () => {
    const { garmin } = adaptGarminPushItem('sleeps', { ...sleep, calendarDate: undefined })
    expect((garmin[0]!.data as { dailySleepDTO: { calendarDate: string } }).dailySleepDTO.calendarDate).toBe(
      '2025-01-15',
    )
  })

  test.each(garbled)('answers nothing for %j', async (item) => {
    const { activities, points } = await runThroughProcessors('sleeps', item)
    expect(activities).toEqual([])
    expect(points).toEqual([])
  })

  test('garbled levels and naps are skipped, not thrown on', async () => {
    const { activities } = await runThroughProcessors('sleeps', {
      ...sleep,
      naps: [null, { napStartTimeInSeconds: 'x' }],
      sleepLevelsMap: { deep: 'x', light: [null, { endTimeInSeconds: 1, startTimeInSeconds: 2 }] },
    })
    expect(activities.map((a) => a.activity_type)).toEqual(['sleep'])
  })
})

describe('hrv', () => {
  test('writes the last-night average at noon of the day', async () => {
    const { points } = await runThroughProcessors('hrv', {
      calendarDate: '2025-01-15',
      hrvValues: { '300': 40 },
      lastNightAvg: 44,
      startTimeInSeconds: DAY_START,
    })
    expect(points).toEqual([
      {
        metric: 'hrv_rmssd',
        source: 'garmin',
        time: new Date('2025-01-15T12:00:00Z'),
        unit: 'ms',
        value: 44,
      },
    ])
  })

  test.each(garbled)('answers nothing for %j', async (item) => {
    const { points } = await runThroughProcessors('hrv', item)
    expect(points).toEqual([])
  })
})

describe('stressDetails', () => {
  const stress = {
    calendarDate: '2025-01-15',
    startTimeInSeconds: DAY_START,
    timeOffsetBodyBatteryValues: { '0': 80, '180': 79 },
    timeOffsetStressLevelValues: { '0': 25, '180': -1, '360': 30 },
  }

  test('writes stress samples with negatives dropped by the processor', async () => {
    const { points } = await runThroughProcessors('stressDetails', stress)
    expect(points.filter((p) => p.metric === 'stress_level')).toEqual([
      {
        metric: 'stress_level',
        source: 'garmin',
        time: new Date(DAY_START * 1000),
        unit: 'score',
        value: 25,
      },
      {
        metric: 'stress_level',
        source: 'garmin',
        time: new Date((DAY_START + 360) * 1000),
        unit: 'score',
        value: 30,
      },
    ])
  })

  test('writes body battery samples when present', async () => {
    const { points } = await runThroughProcessors('stressDetails', stress)
    expect(points.filter((p) => p.metric === 'body_battery').map((p) => p.value)).toEqual([80, 79])
  })

  test('leaves body battery out when absent', () => {
    const { garmin } = adaptGarminPushItem('stressDetails', {
      ...stress,
      timeOffsetBodyBatteryValues: undefined,
    })
    expect(garmin.map((g) => g.dataType)).toEqual(['stress'])
  })

  test.each(garbled)('answers nothing for %j', async (item) => {
    const { points } = await runThroughProcessors('stressDetails', item)
    expect(points).toEqual([])
  })
})

describe('direct points', () => {
  test('pulseox samples as spo2 at their own times, zeros dropped', () => {
    const { garmin, points } = adaptGarminPushItem('pulseox', {
      startTimeInSeconds: DAY_START,
      timeOffsetSpo2Values: { '0': 97, '60': 0, '120': 95 },
    })
    expect(garmin).toEqual([])
    expect(points).toEqual([
      { metric: 'spo2', source: 'garmin', time: new Date(DAY_START * 1000), unit: 'percent', value: 97 },
      {
        metric: 'spo2',
        source: 'garmin',
        time: new Date((DAY_START + 120) * 1000),
        unit: 'percent',
        value: 95,
      },
    ])
  })

  test.each(['timeOffsetEpochToBreaths', 'timeOffsetRespirationValues'])(
    'allDayRespiration samples from %s as respiratory_rate',
    (field) => {
      const { points } = adaptGarminPushItem('allDayRespiration', {
        startTimeInSeconds: DAY_START,
        [field]: { '0': 14.5, '60': -1 },
      })
      expect(points).toEqual([
        {
          metric: 'respiratory_rate',
          source: 'garmin',
          time: new Date(DAY_START * 1000),
          unit: 'brpm',
          value: 14.5,
        },
      ])
    },
  )

  test('userMetrics vo2Max at noon of the day', () => {
    expect(
      adaptGarminPushItem('userMetrics', { calendarDate: '2025-01-15', fitnessAge: 30, vo2Max: 51 }).points,
    ).toEqual([
      {
        metric: 'vo2_max',
        source: 'garmin',
        time: new Date('2025-01-15T12:00:00Z'),
        unit: 'mL/kg/min',
        value: 51,
      },
    ])
    expect(adaptGarminPushItem('userMetrics', { calendarDate: '2025-01-15', vo2Max: 0 }).points).toEqual([])
  })

  test('bodyComps weight, body fat and bone mass at the measurement time', () => {
    const time = new Date(DAY_START * 1000)
    expect(
      adaptGarminPushItem('bodyComps', {
        bodyFatInPercent: 18.5,
        boneMassInGrams: 3100,
        measurementTimeInSeconds: DAY_START,
        muscleMassInGrams: 30000,
        weightInGrams: 72500,
      }).points,
    ).toEqual([
      { metric: 'weight', source: 'garmin', time, unit: 'kg', value: 72.5 },
      { metric: 'body_fat', source: 'garmin', time, unit: 'percent', value: 18.5 },
      { metric: 'bone_mass', source: 'garmin', time, unit: 'kg', value: 3.1 },
    ])
  })

  test.each(['pulseox', 'allDayRespiration', 'userMetrics', 'bodyComps', 'epochs', 'somethingNew'])(
    '%s answers nothing for garbled items',
    (type) => {
      for (const item of garbled) expect(adaptGarminPushItem(type, item)).toEqual({ garmin: [], points: [] })
    },
  )
})
