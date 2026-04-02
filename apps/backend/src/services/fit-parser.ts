/**
 * FIT file parser — extracts activity data from ANT+ FIT files.
 *
 * Supports files from QZ, Garmin, Polar, Suunto, and other devices that
 * produce standard FIT output.
 */
import type { ExerciseTypeName } from '@aurboda/api-spec'

import FitParser from 'fit-file-parser'

export interface FitActivity {
  activity_type: 'exercise'
  exercise_type: ExerciseTypeName
  start_time: Date
  end_time: Date
  title: string
  notes?: string
  data: Record<string, unknown>
  timeSeries: { metric: string; time: Date; value: number }[]
}

/** Map FIT sport names to our exercise type names. */
const sportMap: Record<string, ExerciseTypeName> = {
  cycling: 'biking',
  e_biking: 'biking',
  fitness_equipment: 'other_workout',
  hiking: 'hiking',
  indoor_cycling: 'biking_stationary',
  rowing: 'rowing',
  running: 'running',
  stair_climbing: 'stair_climbing',
  swimming: 'swimming_pool',
  training: 'strength_training',
  walking: 'walking',
  yoga: 'yoga',
}

/** Map FIT sub_sport to override exercise type when more specific. */
const subSportMap: Record<string, ExerciseTypeName> = {
  indoor_cycling: 'biking_stationary',
  indoor_rowing: 'rowing_machine',
  open_water: 'swimming_open_water',
  treadmill: 'running_treadmill',
  virtual_activity: 'running_treadmill',
}

const mapSport = (sport?: string, subSport?: string): ExerciseTypeName => {
  if (subSport && subSportMap[subSport]) return subSportMap[subSport]
  if (sport && sportMap[sport]) return sportMap[sport]
  return 'other_workout'
}

const formatDuration = (seconds: number): string => {
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins}min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

const prettySport = (exerciseType: ExerciseTypeName): string =>
  exerciseType.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())

type FitRecord = Record<string, unknown>

const timeSeriesMetrics = ['heart_rate', 'power', 'cadence', 'speed'] as const

/** Extract time series data points from FIT record messages. */
const extractTimeSeries = (records: FitRecord[]): FitActivity['timeSeries'] => {
  const timeSeries: FitActivity['timeSeries'] = []

  for (const rec of records) {
    const ts = rec.timestamp ? new Date(rec.timestamp as string) : undefined
    if (!ts) continue

    for (const metric of timeSeriesMetrics) {
      if (typeof rec[metric] === 'number' && (rec[metric] as number) > 0) {
        timeSeries.push({ metric, time: ts, value: rec[metric] as number })
      }
    }
  }

  return timeSeries
}

/**
 * Compute end time from session data.
 * Prefers start + elapsed duration (some exporters set timestamp = start_time).
 * Falls back to session timestamp, then last record timestamp.
 */
const computeEndTime = (
  session: FitRecord,
  startTime: Date,
  totalElapsed: number | undefined,
  records: FitRecord[] | undefined,
): Date => {
  if (totalElapsed) return new Date(startTime.getTime() + totalElapsed * 1000)

  if (session.timestamp) {
    const ts = new Date(session.timestamp as string)
    if (ts.getTime() > startTime.getTime()) return ts
  }

  if (records?.length) return new Date(records[records.length - 1].timestamp as string)

  return startTime
}

export const parseFitBuffer = async (buffer: ArrayBuffer | Buffer<ArrayBuffer>): Promise<FitActivity[]> => {
  const parser = new FitParser({ force: true, mode: 'list' })

  const data = await parser.parseAsync(buffer)

  const sessions = data.sessions as FitRecord[] | undefined
  if (!sessions?.length) throw new Error('No sessions found in FIT file')

  const records = data.records as FitRecord[] | undefined

  return sessions.map((session) => {
    const exerciseType = mapSport(
      session.sport as string | undefined,
      session.sub_sport as string | undefined,
    )

    const startTime = new Date(session.start_time as string)
    const totalElapsed = session.total_elapsed_time as number | undefined
    const endTime = computeEndTime(session, startTime, totalElapsed, records)

    const summaryData: Record<string, unknown> = {
      exerciseTypeName: exerciseType,
      source_detail: 'fit_import',
    }
    if (session.total_calories !== undefined) summaryData.calories = session.total_calories
    if (session.total_distance !== undefined) summaryData.distance_meters = session.total_distance

    const duration = totalElapsed ?? (endTime.getTime() - startTime.getTime()) / 1000
    const title = `${prettySport(exerciseType)} ${formatDuration(duration)}`

    return {
      activity_type: 'exercise' as const,
      data: summaryData,
      end_time: endTime,
      exercise_type: exerciseType,
      notes: undefined,
      start_time: startTime,
      timeSeries: records?.length ? extractTimeSeries(records) : [],
      title,
    }
  })
}
