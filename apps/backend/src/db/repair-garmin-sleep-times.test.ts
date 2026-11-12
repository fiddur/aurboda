import { describe, expect, it } from 'vitest'

import { GARMIN_HC_ORIGIN } from '../services/source-identity.ts'
import {
  planSleepNoteMoves,
  planSleepTimeFixes,
  type SleepTimesRow,
  type SyncedSleepNote,
} from './repair-garmin-sleep-times.ts'

const prevDay = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

/** Night ending on `date` for a +02:00 sleeper. */
const night = (date: string) => ({
  end: new Date(`${date}T05:00:00Z`),
  start: new Date(`${prevDay(date)}T21:00:00Z`),
})

const hcPayload = (date: string) => ({
  endTime: `${date}T05:00:00Z`,
  metadata: {
    clientRecordId: String(Date.parse(`${date}T00:00:00+02:00`)),
    dataOrigin: GARMIN_HC_ORIGIN,
  },
  startTime: `${prevDay(date)}T21:00:00Z`,
})

const row = (date: string, spanDate: string, data: Record<string, unknown> = {}): SleepTimesRow => ({
  data,
  end_time: night(spanDate).end,
  external_id: `garmin-sleep-${date}`,
  id: `row-${date}`,
  start_time: night(spanDate).start,
})

const note = (
  id: string,
  entityDate: string,
  nightDate: string,
  updatedAt = '2026-09-26T00:00:00Z',
): SyncedSleepNote => ({
  end_time: night(nightDate).end,
  entity_id: `row-${entityDate}`,
  id,
  start_time: night(nightDate).start,
  updated_at: new Date(updatedAt),
})

/** Night ending on `date` in Pacific/Auckland summer time (+13:00): 22:00 to 07:00 local. */
const nzNight = (date: string) => ({
  end: new Date(`${prevDay(date)}T18:00:00Z`),
  start: new Date(`${prevDay(date)}T09:00:00Z`),
})

/** What an app without `startZoneOffset` uploads for that night (UTC `Z` timestamps). */
const nzPayload = (date: string) => ({
  endTime: nzNight(date).end.toISOString(),
  metadata: {
    clientRecordId: String(Date.parse(`${date}T00:00:00+13:00`)),
    dataOrigin: GARMIN_HC_ORIGIN,
  },
  startTime: nzNight(date).start.toISOString(),
})

describe('planSleepTimeFixes', () => {
  it('takes the row’s own HC payload span when there is no Garmin record and the row holds the next night', () => {
    const fixes = planSleepTimeFixes([row('2026-09-23', '2026-09-24', hcPayload('2026-09-23'))], new Map())
    expect(fixes).toEqual(new Map([['row-2026-09-23', night('2026-09-23')]]))
  })

  it('falls back to the Garmin dailySleepDTO span for a row without a payload', () => {
    const fixes = planSleepTimeFixes(
      [row('2026-09-22', '2026-09-23')],
      new Map([['garmin-sleep-2026-09-22', night('2026-09-22')]]),
    )
    expect(fixes).toEqual(new Map([['row-2026-09-22', night('2026-09-22')]]))
  })

  it('prefers the Garmin dailySleepDTO span over a payload that disagrees with it', () => {
    const garminSpan = { end: night('2026-09-23').end, start: new Date('2026-09-22T21:10:00Z') }
    const fixes = planSleepTimeFixes(
      [row('2026-09-23', '2026-09-24', hcPayload('2026-09-23'))],
      new Map([['garmin-sleep-2026-09-23', garminSpan]]),
    )
    expect(fixes).toEqual(new Map([['row-2026-09-23', garminSpan]]))
  })

  it('keeps a +13:00 row on its own night although its zone-less payload is the next night’s', () => {
    const nz: SleepTimesRow = {
      data: nzPayload('2026-01-10'),
      end_time: nzNight('2026-01-09').end,
      external_id: 'garmin-sleep-2026-01-09',
      id: 'row-nz',
      start_time: nzNight('2026-01-09').start,
    }
    const garminSpans = new Map([['garmin-sleep-2026-01-09', nzNight('2026-01-09')]])
    expect(planSleepTimeFixes([nz], garminSpans).size).toBe(0)
    const overwritten = {
      ...nz,
      end_time: nzNight('2026-01-10').end,
      start_time: nzNight('2026-01-10').start,
    }
    expect(planSleepTimeFixes([overwritten], garminSpans)).toEqual(
      new Map([['row-nz', nzNight('2026-01-09')]]),
    )
  })

  it('ignores a payload filed under another night', () => {
    const fixes = planSleepTimeFixes([row('2026-09-22', '2026-09-23', hcPayload('2026-09-23'))], new Map())
    expect(fixes.size).toBe(0)
  })

  it('leaves a row overlapping its right span alone', () => {
    const slightlyOff = { ...row('2026-09-25', '2026-09-25'), start_time: new Date('2026-09-24T20:55:00Z') }
    const fixes = planSleepTimeFixes(
      [slightlyOff, row('2026-09-24', '2026-09-24', hcPayload('2026-09-24'))],
      new Map([['garmin-sleep-2026-09-25', night('2026-09-25')]]),
    )
    expect(fixes.size).toBe(0)
  })
})

describe('planSleepNoteMoves', () => {
  const rows = ['2026-09-22', '2026-09-23', '2026-09-24'].map((date) => row(date, date))

  it('moves a note to the row whose span holds its start, along a chain of misfiled notes', () => {
    const notes: SyncedSleepNote[] = [
      note('n23', '2026-09-22', '2026-09-23'),
      note('n24', '2026-09-23', '2026-09-24'),
    ]
    expect(planSleepNoteMoves(rows, new Map(), notes)).toEqual({
      duplicates: new Map(),
      moves: new Map([
        ['n23', 'row-2026-09-23'],
        ['n24', 'row-2026-09-24'],
      ]),
    })
  })

  it('treats a moving note as a stale copy when its row keeps a note of its own', () => {
    const notes = [note('stale', '2026-09-23', '2026-09-24'), note('fresh', '2026-09-24', '2026-09-24')]
    expect(planSleepNoteMoves(rows, new Map(), notes)).toEqual({
      duplicates: new Map([['stale', 'fresh']]),
      moves: new Map(),
    })
  })

  it('leaves a note whose night more than one other row overlaps where it is', () => {
    const ambiguous = [
      row('2026-09-22', '2026-09-22'),
      row('2026-09-23', '2026-09-24'),
      row('2026-09-24', '2026-09-24'),
    ]
    expect(planSleepNoteMoves(ambiguous, new Map(), [note('n24', '2026-09-22', '2026-09-24')])).toEqual({
      duplicates: new Map(),
      moves: new Map(),
    })
  })

  it('matches a note on overlap, not only on its start', () => {
    const early = { ...note('n23', '2026-09-22', '2026-09-23'), start_time: new Date('2026-09-22T20:50:00Z') }
    expect(planSleepNoteMoves(rows, new Map(), [early]).moves).toEqual(new Map([['n23', 'row-2026-09-23']]))
  })

  it('uses the repaired spans, and leaves notes with no matching row where they are', () => {
    const shifted = [row('2026-09-22', '2026-09-23'), row('2026-09-23', '2026-09-23')]
    const fixes = new Map([['row-2026-09-22', night('2026-09-22')]])
    const notes = [note('n22', '2026-09-23', '2026-09-22'), note('n30', '2026-09-23', '2026-09-30')]
    expect(planSleepNoteMoves(shifted, fixes, notes)).toEqual({
      duplicates: new Map(),
      moves: new Map([['n22', 'row-2026-09-22']]),
    })
  })
})
