import { describe, expect, it, vi } from 'vitest'

import type { GravlWorkoutDetail } from './types.ts'

vi.mock('../../db/index.ts', () => ({
  adoptLegacyActivity: vi.fn(),
  findActivityByExternalId: vi.fn(),
  insertActivity: vi.fn(),
  insertRawRecord: vi.fn(),
}))
vi.mock('../../db/notes.ts', () => ({ upsertSyncedNote: vi.fn() }))

import {
  buildGravlActivity,
  buildGravlSets,
  formatGravlSetsNote,
  type GravlProcessDeps,
  isExternalWorkout,
  lbToKg,
  processGravlWorkout,
} from './process.ts'

const WORKOUT_ID = '97248067-7947-4715-8FC9-d0048369a0d0'

const detail = (overrides: Partial<GravlWorkoutDetail> = {}): GravlWorkoutDetail => ({
  calories: 210,
  durationMinutes: 29,
  endDate: '2026-09-03T05:45:12Z',
  exercises: [
    {
      exerciseId: 12,
      exerciseName: 'Bench Press',
      sets: [
        { distance: null, duration: null, order: 2, reps: 8, rpe: null, setType: 'Normal', weight: 176.3698 },
        { distance: null, duration: null, order: 1, reps: 10, rpe: null, setType: 'Warmup', weight: 88.1849 },
        { distance: null, duration: null, order: 3, reps: 6, rpe: 8, setType: 'Failure', weight: 176.3698 },
      ],
      supersetId: null,
    },
    {
      exerciseId: 40,
      exerciseName: 'Plank',
      sets: [{ distance: null, duration: 40, order: 1, reps: 0, rpe: null, setType: 'Normal', weight: 0 }],
      supersetId: 3,
    },
  ],
  id: WORKOUT_ID,
  name: 'Push day',
  notes: 'Felt strong',
  personalRecordCount: 1,
  startDate: '2026-09-03T05:16:12Z',
  type: 'Today',
  volume: 3527.396,
  ...overrides,
})

describe('unit conversion', () => {
  it('converts Gravl’s pounds to kilograms with a clean round-trip', () => {
    expect(lbToKg(48.50164)).toBe(22)
    expect(lbToKg(176.3698)).toBe(80)
    expect(lbToKg(0)).toBe(0)
  })
})

describe('buildGravlSets', () => {
  it('flattens exercises into ordered sets in the #1044 shape with kg weights', () => {
    const sets = buildGravlSets(detail())
    expect(sets.map((s) => [s.exercise, s.order, s.set_type, s.weight, s.reps, s.time, s.rpe])).toEqual([
      ['Bench Press', 1, 'warmup', 40, 10, null, null],
      ['Bench Press', 2, 'normal', 80, 8, null, null],
      ['Bench Press', 3, 'failure', 80, 6, null, 8],
      ['Plank', 1, 'normal', null, null, 40, null],
    ])
    expect(sets[3]).toMatchObject({ exercise_id: 40, superset_id: 3 })
    expect('superset_id' in sets[0]).toBe(false)
  })
})

describe('buildGravlActivity', () => {
  it('builds a strength_training activity keyed by the workout id with summary data', () => {
    const activity = buildGravlActivity(detail())
    expect(activity).toMatchObject({
      activity_type: 'strength_training',
      end_time: new Date('2026-09-03T05:45:12Z'),
      external_id: 'gravl-workout-97248067-7947-4715-8fc9-d0048369a0d0',
      source: 'gravl',
      start_time: new Date('2026-09-03T05:16:12Z'),
      title: 'Push day',
    })
    expect(activity.data).toMatchObject({
      calories: 210,
      exercise_count: 2,
      gravl_workout_id: '97248067-7947-4715-8fc9-d0048369a0d0',
      personal_record_count: 1,
      set_count: 4,
      volume_kg: 1600,
      workout_type: 'Today',
    })
  })
})

describe('formatGravlSetsNote', () => {
  it('renders one line per exercise with warmup, failure, rpe and timed sets', () => {
    expect(formatGravlSetsNote(detail())).toBe(
      'Felt strong\n\nBench Press: 10×40 kg (w), 8×80 kg, 6×80 kg (f) @8\nPlank: 0:40',
    )
  })

  it('omits the notes block when the workout has none', () => {
    expect(formatGravlSetsNote(detail({ notes: null }))).toBe(
      'Bench Press: 10×40 kg (w), 8×80 kg, 6×80 kg (f) @8\nPlank: 0:40',
    )
  })
})

describe('processGravlWorkout', () => {
  const makeDeps = (existing: { id: string } | null): GravlProcessDeps => ({
    adoptLegacyActivity: vi.fn().mockResolvedValue(null),
    findActivityByExternalId: vi.fn().mockResolvedValue(existing),
    insertActivity: vi.fn().mockResolvedValue('act-1'),
    insertRawRecord: vi.fn(),
    upsertSyncedNote: vi.fn(),
  })

  it('skips external round-trips without touching the database', async () => {
    const deps = makeDeps(null)
    expect(await processGravlWorkout('alice', detail({ type: 'External' }), deps)).toBe('skipped')
    expect(deps.insertRawRecord).not.toHaveBeenCalled()
    expect(deps.insertActivity).not.toHaveBeenCalled()
  })

  it('claims the Health Connect copy by Gravl’s clientRecordId, then upserts and writes the note', async () => {
    const deps = makeDeps({ id: 'act-1' })
    expect(await processGravlWorkout('alice', detail(), deps)).toBe('enriched')

    expect(deps.insertRawRecord).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({
        external_id: 'gravl-workout-97248067-7947-4715-8fc9-d0048369a0d0',
        record_type: 'gravl_workout',
        source: 'gravl',
      }),
    )
    expect(deps.adoptLegacyActivity).toHaveBeenCalledWith(
      'alice',
      { external_id: 'gravl-workout-97248067-7947-4715-8fc9-d0048369a0d0', source: 'gravl' },
      expect.arrayContaining([
        expect.objectContaining({
          client_record_id: `gravl-session-${WORKOUT_ID}`,
          data_origin: 'com.liteup.getgains',
          kind: 'hc_client_record',
        }),
      ]),
    )
    expect(deps.insertActivity).toHaveBeenCalledWith('alice', expect.objectContaining({ source: 'gravl' }))
    expect(deps.upsertSyncedNote).toHaveBeenCalledWith(
      'alice',
      'activity',
      'act-1',
      'gravl',
      expect.stringContaining('Bench Press: 10×40 kg (w)'),
      new Date('2026-09-03T05:16:12Z'),
      new Date('2026-09-03T05:45:12Z'),
    )
  })

  it('reports a created activity when nothing existed for the identity', async () => {
    const deps = makeDeps(null)
    expect(await processGravlWorkout('alice', detail(), deps)).toBe('created')
  })

  it('treats external workouts by type, not by name', () => {
    expect(isExternalWorkout({ type: 'External' })).toBe(true)
    expect(isExternalWorkout({ type: 'NewSaved' })).toBe(false)
  })
})
