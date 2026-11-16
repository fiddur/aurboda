import { Encoder, Profile } from '@garmin/fitsdk'
import { zipSync } from 'fflate'
import { describe, expect, test } from 'vitest'

import { type FitActivity, fitToDetail, parseActivityFit } from './fit.ts'

const semicircles = (degrees: number): number => Math.round((degrees * 2 ** 31) / 180)

const at = (seconds: number): Date => new Date(Date.UTC(2026, 4, 1, 8, 0, seconds))

interface FitOptions {
  sport?: string
  records: Record<string, unknown>[]
  developerHeartRate?: boolean
}

const encodeFit = ({ developerHeartRate = false, records, sport = 'running' }: FitOptions): Uint8Array => {
  const encoder = new Encoder()
  if (developerHeartRate) {
    const developerDataId = {
      applicationId: Array(16).fill(1),
      applicationVersion: 1,
      developerDataIndex: 0,
      mesgNum: Profile.MesgNum.DEVELOPER_DATA_ID,
    }
    const fieldDescription = {
      developerDataIndex: 0,
      fieldDefinitionNumber: 0,
      fieldName: 'heart_rate',
      fitBaseTypeId: 'uint8',
      mesgNum: Profile.MesgNum.FIELD_DESCRIPTION,
      nativeMesgNum: 'record',
      units: 'bpm',
    }
    encoder.addDeveloperField(0, developerDataId as never, fieldDescription as never)
    encoder.writeMesg(developerDataId as never)
    encoder.writeMesg(fieldDescription as never)
  }
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    manufacturer: 'development',
    product: 1,
    timeCreated: at(0),
    type: 'activity',
  } as never)
  for (const record of records) encoder.onMesg(Profile.MesgNum.RECORD, record as never)
  encoder.onMesg(Profile.MesgNum.LAP, { startTime: at(0), timestamp: at(60), totalElapsedTime: 60 } as never)
  encoder.onMesg(Profile.MesgNum.SESSION, {
    sport,
    startTime: at(0),
    timestamp: at(60),
    totalElapsedTime: 60,
  } as never)
  return encoder.close()
}

const zip = (entries: Record<string, Uint8Array>): Uint8Array => zipSync(entries)

const record = (seconds: number, extra: Record<string, unknown> = {}) => ({
  timestamp: at(seconds),
  ...extra,
})

const start = at(0)

describe('parseActivityFit', () => {
  test('converts semicircle positions to degrees', () => {
    const bytes = zip({
      'activity.fit': encodeFit({
        records: [record(1, { positionLat: semicircles(57.65), positionLong: semicircles(12.62) })],
      }),
    })

    const fit = parseActivityFit(bytes)!
    const { gpsPoints } = fitToDetail(fit, start)

    expect(gpsPoints).toHaveLength(1)
    expect(gpsPoints[0]!.lat).toBeCloseTo(57.65, 6)
    expect(gpsPoints[0]!.lon).toBeCloseTo(12.62, 6)
    expect(gpsPoints[0]).toMatchObject({ source: 'garmin', time: at(1) })
  })

  test('reads heart rate and respiration at each record', () => {
    const bytes = zip({
      'a.FIT': encodeFit({
        records: [
          record(1, { enhancedRespirationRate: 22.5, heartRate: 120 }),
          record(2, { heartRate: 121, respirationRate: 23 }),
        ],
      }),
    })

    const { points } = fitToDetail(parseActivityFit(bytes)!, start)

    expect(points.filter((p) => p.metric === 'heart_rate')).toEqual([
      { metric: 'heart_rate', source: 'garmin', time: at(1), unit: 'bpm', value: 120 },
      { metric: 'heart_rate', source: 'garmin', time: at(2), unit: 'bpm', value: 121 },
    ])
    expect(points.filter((p) => p.metric === 'respiratory_rate')).toEqual([
      { metric: 'respiratory_rate', source: 'garmin', time: at(1), unit: 'brpm', value: 22.5 },
      { metric: 'respiratory_rate', source: 'garmin', time: at(2), unit: 'brpm', value: 23 },
    ])
  })

  test('maps the other record fields to the JSON detail metrics and units', () => {
    const bytes = zip({
      'a.fit': encodeFit({
        records: [
          record(1, {
            cadence: 85,
            enhancedAltitude: 12.4,
            enhancedSpeed: 3.2,
            fractionalCadence: 0.5,
            power: 250,
            stanceTime: 240,
            stepLength: 1100,
            verticalOscillation: 85,
            verticalRatio: 7.5,
            verticalSpeed: -0.4,
          }),
        ],
      }),
    })

    const { points } = fitToDetail(parseActivityFit(bytes)!, start)
    const byMetric = Object.fromEntries(points.map((p) => [p.metric, { unit: p.unit, value: p.value }]))

    expect(byMetric).toEqual({
      elevation: { unit: 'm', value: 12.4 },
      ground_contact_time: { unit: 'ms', value: 240 },
      power: { unit: 'W', value: 250 },
      run_cadence: { unit: 'spm', value: 171 },
      speed: { unit: 'm/s', value: 3.2 },
      stride_length: { unit: 'm', value: 1.1 },
      vertical_oscillation: { unit: 'cm', value: 8.5 },
      vertical_ratio: { unit: 'percent', value: 7.5 },
      vertical_speed: { unit: 'm/s', value: -0.4 },
    })
  })

  test('writes no run cadence for a sport whose cadence is not strides', () => {
    const bytes = zip({ 'a.fit': encodeFit({ records: [record(1, { cadence: 90 })], sport: 'cycling' }) })

    const { points } = fitToDetail(parseActivityFit(bytes)!, start)

    expect(points.map((p) => p.metric)).not.toContain('run_cadence')
  })

  test('drops records without a position and 0,0 fixes from GPS and the track', () => {
    const bytes = zip({
      'a.fit': encodeFit({
        records: [
          record(1, {
            enhancedAltitude: 10,
            positionLat: semicircles(57.65),
            positionLong: semicircles(12.62),
          }),
          record(2, { heartRate: 120 }),
          record(3, { positionLat: 0, positionLong: 0 }),
          record(4, { altitude: 11, positionLat: semicircles(57.66), positionLong: semicircles(12.63) }),
        ],
      }),
    })

    const { gpsPoints, trackPoints } = fitToDetail(parseActivityFit(bytes)!, start)

    expect(gpsPoints.map((p) => p.time)).toEqual([at(1), at(4)])
    expect(trackPoints.map((p) => [p.time, p.alt])).toEqual([
      [at(1), 10],
      [at(4), 11],
    ])
  })

  test('merges two .fit entries in time order', () => {
    const bytes = zip({
      'a.fit': encodeFit({ records: [record(10, { heartRate: 130 }), record(30, { heartRate: 132 })] }),
      'b.fit': encodeFit({ records: [record(5, { heartRate: 120 }), record(20, { heartRate: 131 })] }),
    })

    const fit = parseActivityFit(bytes)!
    const { points, summary } = fitToDetail(fit, start)

    expect(points.map((p) => p.value)).toEqual([120, 130, 131, 132])
    expect(summary.record_count).toBe(4)
    expect(summary.sessions).toHaveLength(2)
  })

  test('a ZIP without a .fit entry is no file', () => {
    expect(parseActivityFit(zip({ 'readme.txt': new TextEncoder().encode('hello') }))).toBeNull()
  })

  test('bytes that are not a ZIP are no file', () => {
    expect(parseActivityFit(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  })

  test('a corrupt .fit entry is no file', () => {
    const fit = encodeFit({ records: [record(1, { heartRate: 120 })] })
    const corrupt = fit.slice()
    corrupt[corrupt.length - 5] = corrupt[corrupt.length - 5]! ^ 0xff

    expect(parseActivityFit(zip({ 'a.fit': corrupt }))).toBeNull()
    expect(parseActivityFit(zip({ 'a.fit': fit.slice(0, 20) }))).toBeNull()
  })

  test('refuses an entry over the size limit', () => {
    const fit = encodeFit({ records: [record(1, { heartRate: 120 })] })

    expect(parseActivityFit(zip({ 'a.fit': fit }), fit.length - 1)).toBeNull()
    expect(parseActivityFit(zip({ 'a.fit': fit }), fit.length)).not.toBeNull()
  })

  test('ignores developer fields, also one named like a profile field', () => {
    const bytes = zip({
      'a.fit': encodeFit({
        developerHeartRate: true,
        records: [record(1, { developerFields: { 0: 99 }, power: 200 })],
      }),
    })

    const fit = parseActivityFit(bytes)!
    const { points } = fitToDetail(fit, start)

    expect(points.map((p) => p.metric)).toEqual(['power'])
  })
})

describe('fitToDetail', () => {
  const fit = (records: FitActivity['records']): FitActivity => ({
    fileIds: [{ manufacturer: 'garmin', type: 'activity' }],
    laps: [{ developerFields: { 0: 1 }, totalElapsedTime: 60 }],
    records,
    sessions: [{ sport: 'running', totalElapsedTime: 60 }],
  })

  test('the summary holds the file id, sessions, laps and the record count only', () => {
    const { summary } = fitToDetail(fit([{ heartRate: 120, timestamp: at(1) }]), start)

    expect(summary).toEqual({
      file_id: [{ manufacturer: 'garmin', type: 'activity' }],
      laps: [{ totalElapsedTime: 60 }],
      record_count: 1,
      sessions: [{ sport: 'running', totalElapsedTime: 60 }],
    })
  })

  test('files the raw record at the first record, else at the activity start', () => {
    expect(fitToDetail(fit([{ heartRate: 120, timestamp: at(7) }]), start).recordedAt).toEqual(at(7))
    expect(fitToDetail(fit([]), start).recordedAt).toEqual(start)
  })

  test('reads only profile fields of a record', () => {
    const { points } = fitToDetail(
      fit([{ heartRate: 120, someVendorField: 7, timestamp: at(1) } as FitActivity['records'][number]]),
      start,
    )

    expect(points.map((p) => p.metric)).toEqual(['heart_rate'])
  })
})
