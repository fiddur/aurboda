import { describe, expect, it } from 'vitest'

import {
  GARMIN_HC_ORIGIN,
  GRAVL_HC_ORIGIN,
  gravlWorkoutIdFromClientRecord,
  isoOffsetMs,
  localCalendarDate,
  resolveHealthConnectIdentity,
} from './source-identity.ts'

const hc = (dataOrigin: string, clientRecordId: string, extra: Record<string, unknown> = {}) => ({
  endTime: '2026-09-03T07:45:12.818+02:00',
  metadata: { clientRecordId, dataOrigin, id: 'hc-uuid' },
  startTime: '2026-09-03T07:16:12.818+02:00',
  ...extra,
})

describe('resolveHealthConnectIdentity', () => {
  it('maps a Gravl session to the gravl workout identity', () => {
    const identity = resolveHealthConnectIdentity(
      'ExerciseSessionRecord',
      hc(GRAVL_HC_ORIGIN, 'gravl-session-7813DB13-6778-4cba-94d1-cea575f01012'),
    )
    expect(identity).toMatchObject({
      data: { gravl_workout_id: '7813db13-6778-4cba-94d1-cea575f01012' },
      external_id: 'gravl-workout-7813db13-6778-4cba-94d1-cea575f01012',
      key: '7813db13-6778-4cba-94d1-cea575f01012',
      kind: 'activity',
      provider: 'gravl',
      source: 'gravl',
    })
    expect(identity?.legacy).toEqual([
      {
        client_record_id: 'gravl-session-7813DB13-6778-4cba-94d1-cea575f01012',
        data_origin: GRAVL_HC_ORIGIN,
        kind: 'hc_client_record',
      },
    ])
  })

  it('maps a Garmin exercise to the scraper’s garmin-activity id and keeps the numeric id in data', () => {
    const identity = resolveHealthConnectIdentity(
      'ExerciseSessionRecord',
      hc(GARMIN_HC_ORIGIN, '24218667980'),
    )
    expect(identity).toMatchObject({
      data: { garmin_activity_id: 24218667980 },
      external_id: 'garmin-activity-24218667980',
      key: '24218667980',
      kind: 'activity',
      provider: 'garmin',
    })
    expect(identity?.legacy[0]).toEqual({ garmin_activity_id: 24218667980, kind: 'garmin_activity_id' })
  })

  it('derives the Garmin sleep calendar date from the local-midnight client record id', () => {
    const identity = resolveHealthConnectIdentity(
      'SleepSessionRecord',
      hc(GARMIN_HC_ORIGIN, '1788386400000', { startTime: '2026-09-03T00:49:43+02:00' }),
    )
    expect(identity).toMatchObject({
      external_id: 'garmin-sleep-2026-09-03',
      key: '2026-09-03',
      kind: 'sleep',
      provider: 'garmin',
    })
    // A legacy garmin sleep row from the scraper shares the exact start instant.
    expect(identity?.legacy[0]).toEqual({
      activity_type: 'sleep',
      kind: 'source_type_start',
      source: 'garmin',
      start_time: new Date('2026-09-02T22:49:43Z'),
    })
  })

  it('uses the record’s own offset, so a west-of-UTC sleep still lands on its local date', () => {
    // 2026-09-03 00:00 in America/New_York (-04:00) = 2026-09-03T04:00:00Z
    const identity = resolveHealthConnectIdentity(
      'SleepSessionRecord',
      hc(GARMIN_HC_ORIGIN, String(Date.parse('2026-09-03T04:00:00Z')), {
        startTime: '2026-09-02T23:10:00-04:00',
      }),
    )
    expect(identity?.external_id).toBe('garmin-sleep-2026-09-03')
  })

  it('returns null for unknown origins, unparsable keys and non-session records', () => {
    expect(resolveHealthConnectIdentity('ExerciseSessionRecord', hc('com.polar.polarflow', '123'))).toBeNull()
    expect(resolveHealthConnectIdentity('ExerciseSessionRecord', hc(GARMIN_HC_ORIGIN, 'abc'))).toBeNull()
    expect(
      resolveHealthConnectIdentity('ExerciseSessionRecord', hc(GRAVL_HC_ORIGIN, 'gravl-session-nope')),
    ).toBeNull()
    expect(resolveHealthConnectIdentity('HeartRateRecord', hc(GARMIN_HC_ORIGIN, '123'))).toBeNull()
    expect(
      resolveHealthConnectIdentity('SleepSessionRecord', hc(GRAVL_HC_ORIGIN, 'gravl-session-x')),
    ).toBeNull()
    expect(resolveHealthConnectIdentity('ExerciseSessionRecord', { startTime: 'x' })).toBeNull()
  })

  it('gives up on a Garmin sleep whose startTime carries no offset', () => {
    expect(
      resolveHealthConnectIdentity(
        'SleepSessionRecord',
        hc(GARMIN_HC_ORIGIN, '1788386400000', { startTime: 'soon' }),
      ),
    ).toBeNull()
  })
})

describe('helpers', () => {
  it('parses ISO offsets', () => {
    expect(isoOffsetMs('2026-09-03T00:49:43+02:00')).toBe(7_200_000)
    expect(isoOffsetMs('2026-09-03T00:49:43-05:30')).toBe(-19_800_000)
    expect(isoOffsetMs('2026-09-03T00:49:43Z')).toBe(0)
    expect(isoOffsetMs('2026-09-03T00:49:43')).toBeNull()
  })

  it('formats the local calendar date', () => {
    expect(localCalendarDate(Date.parse('2026-09-02T22:00:00Z'), 7_200_000)).toBe('2026-09-03')
    expect(localCalendarDate(Date.parse('2026-09-02T22:00:00Z'), 0)).toBe('2026-09-02')
  })

  it('extracts the Gravl workout id from a client record id', () => {
    expect(gravlWorkoutIdFromClientRecord('gravl-session-97248067-7947-4715-8fc9-d0048369a0d0')).toBe(
      '97248067-7947-4715-8fc9-d0048369a0d0',
    )
    expect(gravlWorkoutIdFromClientRecord('24218667980')).toBeNull()
  })
})
