/**
 * Turns one item of a Garmin Developer Program push into the shapes the pull processors
 * (`processGarminData`) already read, so both connections write the same rows. Field names
 * come from public descriptions of the push API, not from payloads seen here: every adapter
 * answers "nothing" for a missing or differently typed field and never throws.
 */

import { metricUnits, type MetricType } from '@aurboda/api-spec'

import type { TimeSeriesPoint } from '../../db/types.ts'
import type { GarminDataType } from './process.ts'

export interface GarminPushTypeInfo {
  /** The pull data types this summary type fills; a user who disabled them all gets nothing stored. */
  feeds: GarminDataType[]
}

const rawOnly: GarminPushTypeInfo = { feeds: [] }

export const garminPushTypes: Record<string, GarminPushTypeInfo> = {
  activities: rawOnly,
  activityDetails: rawOnly,
  activityFiles: rawOnly,
  allDayRespiration: { feeds: ['respiration'] },
  bloodPressures: rawOnly,
  bodyComps: rawOnly,
  dailies: { feeds: ['dailySummary', 'heartRate', 'intensityMinutes'] },
  epochs: rawOnly,
  healthSnapshot: rawOnly,
  hrv: { feeds: ['hrv'] },
  manuallyUpdatedActivities: rawOnly,
  mct: rawOnly,
  menstrualCycleTracking: rawOnly,
  moveIQActivities: rawOnly,
  pulseox: { feeds: ['spo2'] },
  skinTemp: rawOnly,
  sleeps: { feeds: ['sleep'] },
  stressDetails: { feeds: ['stress', 'bodyBattery'] },
  userMetrics: rawOnly,
}

/** Lifecycle notices: acted on, never stored. */
export const garminPushLifecycleTypes = ['deregistrations', 'userPermissionsChange'] as const

export const garminPushFeeds = (type: string): GarminDataType[] =>
  (Object.hasOwn(garminPushTypes, type) ? garminPushTypes[type]?.feeds : undefined) ?? []

export interface GarminPushAdapted {
  /** Payloads for `processGarminData`, each under the pull data type it reads as. */
  garmin: { dataType: GarminDataType; data: unknown }[]
  /** Points written directly, for types the pull processors keep only as a daily figure. */
  points: TimeSeriesPoint[]
}

const NOTHING: GarminPushAdapted = { garmin: [], points: [] }

type Item = Record<string, unknown>

export const isPlainObject = (value: unknown): value is Item =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const firstNum = (...values: unknown[]): number | undefined => values.map(num).find((v) => v !== undefined)

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

export const isCalendarDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  CALENDAR_DATE.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

const utcDate = (ms: number): string | undefined => {
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10)
}

/** `calendarDate`, else the user's local day: the UTC date of start + the offset Garmin sends. */
export const pushCalendarDate = (item: Item): string | undefined => {
  if (isCalendarDate(item.calendarDate)) return item.calendarDate
  const start = num(item.startTimeInSeconds)
  if (start === undefined) return undefined
  return utcDate((start + (num(item.startTimeOffsetInSeconds) ?? 0)) * 1000)
}

export const noonUtc = (calendarDate: string): Date => new Date(`${calendarDate}T12:00:00Z`)

/** `{ "<offsetSeconds>": value }` after `startSeconds`, as `[epochMs, value]` pairs in time order. */
export const offsetSamples = (map: unknown, startSeconds: number | undefined): [number, number][] => {
  if (!isPlainObject(map) || startSeconds === undefined) return []
  return Object.entries(map)
    .flatMap(([offset, value]): [number, number][] => {
      const seconds = Number(offset)
      const v = num(value)
      if (offset.trim() === '' || !Number.isFinite(seconds) || v === undefined) return []
      return [[(startSeconds + seconds) * 1000, v]]
    })
    .sort((a, b) => a[0] - b[0])
}

const point = (metric: MetricType, time: Date, value: number): TimeSeriesPoint => ({
  metric,
  source: 'garmin',
  time,
  unit: metricUnits[metric],
  value,
})

const samplePoints = (metric: MetricType, samples: [number, number][]): TimeSeriesPoint[] =>
  samples.filter(([, value]) => value > 0).map(([ms, value]) => point(metric, new Date(ms), value))

const adaptDailies = (item: Item): GarminPushAdapted => {
  const calendarDate = pushCalendarDate(item)
  if (!calendarDate) return NOTHING
  const active = num(item.activeKilocalories)
  const bmr = num(item.bmrKilocalories)
  const garmin: GarminPushAdapted['garmin'] = [
    {
      data: {
        activeKilocalories: active,
        averageSpo2: num(item.averageSpo2),
        averageStressLevel: num(item.averageStressLevel),
        calendarDate,
        floorsAscended: num(item.floorsClimbed),
        restingHeartRate: num(item.restingHeartRateInBeatsPerMinute),
        totalDistanceMeters: num(item.distanceInMeters),
        totalKilocalories: active !== undefined && bmr !== undefined ? active + bmr : undefined,
        totalSteps: num(item.steps),
      },
      dataType: 'dailySummary',
    },
  ]

  const heartRateValues = offsetSamples(item.timeOffsetHeartRateSamples, num(item.startTimeInSeconds))
  if (heartRateValues.length > 0) {
    garmin.push({ data: { calendarDate, heartRateValues }, dataType: 'heartRate' })
  }

  const moderate = num(item.moderateIntensityDurationInSeconds)
  const vigorous = num(item.vigorousIntensityDurationInSeconds)
  if (moderate !== undefined || vigorous !== undefined) {
    garmin.push({
      data: {
        calendarDate,
        moderateMinutes: Math.round((moderate ?? 0) / 60),
        vigorousMinutes: Math.round((vigorous ?? 0) / 60),
      },
      dataType: 'intensityMinutes',
    })
  }
  return { garmin, points: [] }
}

const SLEEP_LEVELS: Record<string, number> = { awake: 3, deep: 0, light: 1, rem: 2 }

interface PushSleepLevel {
  startGMT: string
  endGMT: string
  activityLevel: number
  endSeconds: number
}

const sleepLevels = (map: unknown): PushSleepLevel[] => {
  if (!isPlainObject(map)) return []
  return Object.entries(map)
    .flatMap(([key, intervals]) => {
      const activityLevel = SLEEP_LEVELS[key]
      if (activityLevel === undefined || !Array.isArray(intervals)) return []
      return intervals.flatMap((interval): PushSleepLevel[] => {
        if (!isPlainObject(interval)) return []
        const start = num(interval.startTimeInSeconds)
        const end = num(interval.endTimeInSeconds)
        if (start === undefined || end === undefined || end <= start) return []
        return [
          {
            activityLevel,
            endGMT: new Date(end * 1000).toISOString(),
            endSeconds: end,
            startGMT: new Date(start * 1000).toISOString(),
          },
        ]
      })
    })
    .sort((a, b) => a.startGMT.localeCompare(b.startGMT))
}

/** The pull's nap timestamp format, so `garmin-nap-<start>` ids match across both connections. */
const garminGmt = (ms: number): string => new Date(ms).toISOString().slice(0, 19)

const naps = (list: unknown) =>
  (Array.isArray(list) ? list : []).flatMap((nap) => {
    if (!isPlainObject(nap)) return []
    const start = num(nap.napStartTimeInSeconds)
    const duration = num(nap.napDurationInSeconds)
    if (start === undefined || duration === undefined || duration <= 0) return []
    return [
      {
        napEndTimestampGMT: garminGmt((start + duration) * 1000),
        napStartTimestampGMT: garminGmt(start * 1000),
        napTimeSec: duration,
      },
    ]
  })

const sleepScore = (value: unknown): number | undefined =>
  isPlainObject(value) ? num(value.value) : num(value)

const adaptSleeps = (item: Item): GarminPushAdapted => {
  const start = num(item.startTimeInSeconds)
  if (start === undefined) return NOTHING
  const levels = sleepLevels(item.sleepLevelsMap)
  const duration = num(item.durationInSeconds)
  const end =
    levels.length > 0
      ? Math.max(...levels.map((level) => level.endSeconds))
      : duration !== undefined
        ? start + duration
        : undefined
  const calendarDate = isCalendarDate(item.calendarDate) ? item.calendarDate : utcDate((end ?? start) * 1000)
  if (!calendarDate) return NOTHING
  const score = sleepScore(item.overallSleepScore)

  return {
    garmin: [
      {
        data: {
          avgOvernightHrv: 0,
          dailySleepDTO: {
            awakeSleepSeconds: firstNum(item.awakeDurationInSeconds, item.awakeSleepSeconds),
            calendarDate,
            dailyNapDTOS: naps(item.naps),
            deepSleepSeconds: firstNum(item.deepSleepDurationInSeconds, item.deepSleepSeconds),
            lightSleepSeconds: firstNum(item.lightSleepDurationInSeconds, item.lightSleepSeconds),
            remSleepSeconds: firstNum(item.remSleepInSeconds, item.remSleepDurationInSeconds),
            sleepEndTimestampGMT: end === undefined ? undefined : end * 1000,
            sleepScores: score === undefined ? undefined : { overall: { value: score } },
            sleepStartTimestampGMT: start * 1000,
          },
          restingHeartRate: 0,
          sleepHeartRate: [],
          sleepLevels: levels.map(({ activityLevel, endGMT, startGMT }) => ({
            activityLevel,
            endGMT,
            startGMT,
          })),
        },
        dataType: 'sleep',
      },
    ],
    points: [],
  }
}

const adaptHrv = (item: Item): GarminPushAdapted => {
  const calendarDate = pushCalendarDate(item)
  if (!calendarDate) return NOTHING
  return {
    garmin: [
      { data: { hrvSummary: { calendarDate, lastNightAvg: num(item.lastNightAvg) } }, dataType: 'hrv' },
    ],
    points: [],
  }
}

const adaptStressDetails = (item: Item): GarminPushAdapted => {
  const calendarDate = pushCalendarDate(item)
  if (!calendarDate) return NOTHING
  const start = num(item.startTimeInSeconds)
  const garmin: GarminPushAdapted['garmin'] = []
  const stressValuesArray = offsetSamples(item.timeOffsetStressLevelValues, start)
  if (stressValuesArray.length > 0) {
    garmin.push({ data: { calendarDate, overallStressLevel: 0, stressValuesArray }, dataType: 'stress' })
  }
  const bodyBatteryValuesArray = offsetSamples(item.timeOffsetBodyBatteryValues, start)
  if (bodyBatteryValuesArray.length > 0) {
    garmin.push({
      data: [{ bodyBatteryValuesArray, charged: 0, date: calendarDate }],
      dataType: 'bodyBattery',
    })
  }
  return { garmin, points: [] }
}

const adaptPulseOx = (item: Item): GarminPushAdapted => ({
  garmin: [],
  points: samplePoints('spo2', offsetSamples(item.timeOffsetSpo2Values, num(item.startTimeInSeconds))),
})

/** `timeOffsetEpochToBreaths` per the plan; `timeOffsetRespirationValues` in another reading of the API. */
const adaptAllDayRespiration = (item: Item): GarminPushAdapted => ({
  garmin: [],
  points: samplePoints(
    'respiratory_rate',
    offsetSamples(
      item.timeOffsetEpochToBreaths ?? item.timeOffsetRespirationValues,
      num(item.startTimeInSeconds),
    ),
  ),
})

const adaptUserMetrics = (item: Item): GarminPushAdapted => {
  const calendarDate = isCalendarDate(item.calendarDate) ? item.calendarDate : undefined
  const vo2Max = num(item.vo2Max)
  if (!calendarDate || vo2Max === undefined || vo2Max <= 0) return NOTHING
  return { garmin: [], points: [point('vo2_max', noonUtc(calendarDate), vo2Max)] }
}

const adaptBodyComps = (item: Item): GarminPushAdapted => {
  const measured = num(item.measurementTimeInSeconds)
  if (measured === undefined) return NOTHING
  const time = new Date(measured * 1000)
  const grams = (value: unknown) => {
    const g = num(value)
    return g === undefined ? undefined : g / 1000
  }
  const candidates: [MetricType, number | undefined][] = [
    ['weight', grams(item.weightInGrams)],
    ['body_fat', num(item.bodyFatInPercent)],
    ['bone_mass', grams(item.boneMassInGrams)],
  ]
  return {
    garmin: [],
    points: candidates.flatMap(([metric, value]) =>
      value !== undefined && value > 0 ? [point(metric, time, value)] : [],
    ),
  }
}

const adapters: Record<string, (item: Item) => GarminPushAdapted> = {
  allDayRespiration: adaptAllDayRespiration,
  bodyComps: adaptBodyComps,
  dailies: adaptDailies,
  hrv: adaptHrv,
  pulseox: adaptPulseOx,
  sleeps: adaptSleeps,
  stressDetails: adaptStressDetails,
  userMetrics: adaptUserMetrics,
}

export const adaptGarminPushItem = (type: string, item: unknown): GarminPushAdapted => {
  const adapt = Object.hasOwn(adapters, type) ? adapters[type] : undefined
  if (!adapt || !isPlainObject(item)) return NOTHING
  try {
    return adapt(item)
  } catch {
    return NOTHING
  }
}
