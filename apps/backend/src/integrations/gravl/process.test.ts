import { describe, expect, it, vi } from 'vitest'

import type { GravlSet, GravlWorkoutDetail, GravlWorkoutExercise, GravlWorkoutSummary } from './types.ts'

vi.mock('../../db/index.ts', () => ({
  adoptLegacyActivity: vi.fn(),
  findActivityByExternalId: vi.fn(),
  insertActivity: vi.fn(),
  insertRawRecord: vi.fn(),
  materializeSuperseded: vi.fn(),
  restoreEmptyImportTombstone: vi.fn(),
  restoreSetlessTombstone: vi.fn(),
  softDeleteActivityByExternalId: vi.fn(),
}))
vi.mock('../../db/notes.ts', () => ({ upsertSyncedNote: vi.fn() }))
vi.mock('../../services/audit-log.ts', () => ({ auditInfo: vi.fn() }))

import {
  buildGravlActivity,
  buildGravlSets,
  formatGravlSetsNote,
  type GravlProcessDeps,
  hasLoggedSets,
  isExternalWorkout,
  isStrengthWorkout,
  lbToKg,
  mayCarryLoggedSets,
  processGravlWorkout,
  retractEmptyGravlImport,
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
        { distance: null, duration: null, order: 2, reps: 8, rpe: null, setType: 'normal', weight: 176.3698 },
        { distance: null, duration: null, order: 1, reps: 10, rpe: null, setType: 'warmup', weight: 88.1849 },
        { distance: null, duration: null, order: 3, reps: 6, rpe: 8, setType: 'failure', weight: 176.3698 },
      ],
      supersetId: null,
    },
    {
      exerciseId: 40,
      exerciseName: 'Plank',
      sets: [{ distance: null, duration: 40, order: 1, reps: 0, rpe: null, setType: 'dropSet', weight: 0 }],
      supersetId: 3,
    },
  ],
  id: WORKOUT_ID,
  name: 'Push day',
  notes: 'Felt strong',
  personalRecordCount: 1,
  startDate: '2026-09-03T05:16:12Z',
  type: 'today',
  volume: 3527.396,
  ...overrides,
})

const set = (overrides: Partial<GravlSet> = {}): GravlSet => ({
  distance: null,
  duration: null,
  order: 1,
  reps: 0,
  rpe: null,
  setType: 'normal',
  weight: 0,
  ...overrides,
})

const exercise = (exerciseName: string, sets: GravlSet[]): GravlWorkoutExercise => ({
  exerciseId: exerciseName.length,
  exerciseName,
  sets,
  supersetId: null,
})

const walking = exercise('Walking', [set({ distance: 2400, duration: 1800 })])

/** A plain round-trip: the imported session as Gravl's single cardio pseudo-exercise. */
const roundTrip = (): GravlWorkoutDetail =>
  detail({ exercises: [walking], name: 'External Workout - 2026-08-30', type: 'external', volume: 0 })

/** An external session onto which sets were logged in Gravl (#1333). */
const loggedExternal = (): GravlWorkoutDetail =>
  detail({
    exercises: [walking, exercise('Squat', [set({ reps: 8, weight: 220.462 })])],
    name: 'External Workout - 2026-08-30',
    type: 'external',
    volume: 5370,
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
      ['Plank', 1, 'drop_set', null, null, 40, null],
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
      workout_type: 'today',
    })
  })
})

describe('formatGravlSetsNote', () => {
  it('renders one line per exercise with warmup, failure, rpe and timed sets', () => {
    expect(formatGravlSetsNote(detail())).toBe(
      'Felt strong\n\nBench Press: 10×40 kg (w), 8×80 kg, 6×80 kg (f) @8\nPlank: 0:40 (drop)',
    )
  })

  it('omits the notes block when the workout has none', () => {
    expect(formatGravlSetsNote(detail({ notes: null }))).toBe(
      'Bench Press: 10×40 kg (w), 8×80 kg, 6×80 kg (f) @8\nPlank: 0:40 (drop)',
    )
  })
})

describe('processGravlWorkout', () => {
  const makeDeps = (
    existing: { id: string; data?: Record<string, unknown>; start_time?: Date } | null,
  ): GravlProcessDeps => ({
    adoptLegacyActivity: vi.fn().mockResolvedValue(null),
    auditInfo: vi.fn(),
    findActivityByExternalId: vi.fn().mockResolvedValue(existing),
    insertActivity: vi.fn().mockResolvedValue('act-1'),
    insertRawRecord: vi.fn(),
    materializeSuperseded: vi.fn(),
    restoreEmptyImportTombstone: vi.fn().mockResolvedValue(false),
    restoreSetlessTombstone: vi.fn().mockResolvedValue(false),
    softDeleteActivityByExternalId: vi.fn(),
    upsertSyncedNote: vi.fn(),
  })

  it('skips an external round-trip we never stored', async () => {
    const deps = makeDeps(null)
    expect(await processGravlWorkout('alice', roundTrip(), deps)).toBe('skipped')
    expect(deps.softDeleteActivityByExternalId).not.toHaveBeenCalled()
    expect(deps.materializeSuperseded).not.toHaveBeenCalled()
    expect(deps.insertRawRecord).not.toHaveBeenCalled()
    expect(deps.insertActivity).not.toHaveBeenCalled()
  })

  it('removes the Health Connect copy of an external round-trip and re-merges around it', async () => {
    const deps = makeDeps({ id: 'act-1', start_time: new Date('2026-09-03T05:16:12Z') })
    expect(await processGravlWorkout('alice', roundTrip(), deps)).toBe('removed')
    expect(deps.softDeleteActivityByExternalId).toHaveBeenCalledWith(
      'alice',
      'gravl',
      'gravl-workout-97248067-7947-4715-8fc9-d0048369a0d0',
    )
    expect(deps.upsertSyncedNote).toHaveBeenCalledWith('alice', 'activity', 'act-1', 'gravl', undefined)
    expect(deps.materializeSuperseded).toHaveBeenCalledWith('alice', new Date('2026-09-03T05:16:12Z'))
    expect(deps.auditInfo).toHaveBeenCalledWith(
      'alice',
      'sync',
      expect.stringContaining('Removed Health Connect copy'),
      expect.objectContaining({
        activity_id: 'act-1',
        workout_id: '97248067-7947-4715-8fc9-d0048369a0d0',
      }),
    )
    expect(deps.insertRawRecord).not.toHaveBeenCalled()
    expect(deps.insertActivity).not.toHaveBeenCalled()
    expect(deps.adoptLegacyActivity).not.toHaveBeenCalled()
  })

  it('removes an external workout whose only sets are the cardio pseudo-exercise', async () => {
    const deps = makeDeps({ id: 'act-1', start_time: new Date('2026-09-03T05:16:12Z') })
    const pseudoOnly = detail({
      exercises: [walking, exercise('Squat', [])],
      type: 'external',
      volume: 0,
    })
    expect(await processGravlWorkout('alice', pseudoOnly, deps)).toBe('removed')
    expect(deps.restoreSetlessTombstone).not.toHaveBeenCalled()
    expect(deps.insertActivity).not.toHaveBeenCalled()
  })

  it('imports an external workout onto which sets were logged, without its pseudo-exercise', async () => {
    const deps = makeDeps(null)
    expect(await processGravlWorkout('alice', loggedExternal(), deps)).toBe('created')

    expect(deps.softDeleteActivityByExternalId).not.toHaveBeenCalled()
    expect(deps.insertRawRecord).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ external_id: 'gravl-workout-97248067-7947-4715-8fc9-d0048369a0d0' }),
    )
    expect(deps.adoptLegacyActivity).toHaveBeenCalled()
    const activity = vi.mocked(deps.insertActivity).mock.calls[0][1]
    expect(activity).toMatchObject({
      activity_type: 'strength_training',
      source: 'gravl',
      title: 'External Workout - 2026-08-30',
    })
    expect(activity.data).toMatchObject({ exercise_count: 1, set_count: 1, workout_type: 'external' })
    expect(activity.data?.sets).toEqual([
      expect.objectContaining({ exercise: 'Squat', reps: 8, weight: 100 }),
    ])
    expect(deps.upsertSyncedNote).toHaveBeenCalledWith(
      'alice',
      'activity',
      'act-1',
      'gravl',
      expect.stringContaining('Squat: 8×100 kg'),
      new Date('2026-09-03T05:16:12Z'),
      new Date('2026-09-03T05:45:12Z'),
    )
    expect(vi.mocked(deps.upsertSyncedNote).mock.calls[0][4]).not.toContain('Walking')
    expect(deps.materializeSuperseded).not.toHaveBeenCalled()
  })

  it('enriches the live Health Connect copy of an external workout with its logged sets', async () => {
    const deps = makeDeps({ data: { metadata: {} }, id: 'act-1' })
    expect(await processGravlWorkout('alice', loggedExternal(), deps)).toBe('enriched')
    expect(deps.softDeleteActivityByExternalId).not.toHaveBeenCalled()
    expect(deps.insertActivity).toHaveBeenCalled()
  })

  it('restores the removed copy of an external workout before importing its logged sets', async () => {
    const deps = makeDeps({ data: { metadata: {} }, id: 'act-1' })
    vi.mocked(deps.restoreSetlessTombstone).mockResolvedValue(true)

    expect(await processGravlWorkout('alice', loggedExternal(), deps)).toBe('enriched')

    expect(deps.restoreSetlessTombstone).toHaveBeenCalledWith(
      'alice',
      'gravl',
      'gravl-workout-97248067-7947-4715-8fc9-d0048369a0d0',
    )
    expect(deps.restoreEmptyImportTombstone).not.toHaveBeenCalled()
    expect(vi.mocked(deps.restoreSetlessTombstone).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.insertActivity).mock.invocationCallOrder[0],
    )
    expect(deps.materializeSuperseded).toHaveBeenCalledWith('alice', new Date('2026-09-03T05:16:12Z'))
  })

  it('skips a workout with no logged set', async () => {
    const deps = makeDeps(null)
    expect(await processGravlWorkout('alice', detail({ exercises: [] }), deps)).toBe('skipped')
    expect(deps.insertRawRecord).not.toHaveBeenCalled()
    expect(deps.insertActivity).not.toHaveBeenCalled()
    expect(deps.softDeleteActivityByExternalId).not.toHaveBeenCalled()
  })

  it('retracts the empty row an earlier run imported for a set-less workout', async () => {
    const startTime = new Date('2026-09-08T09:04:51+02:00')
    const deps = makeDeps({ data: { sets: [], workout_type: 'today' }, id: 'act-9', start_time: startTime })
    expect(await processGravlWorkout('alice', detail({ exercises: [] }), deps)).toBe('removed')
    expect(deps.softDeleteActivityByExternalId).toHaveBeenCalledWith(
      'alice',
      'gravl',
      'gravl-workout-97248067-7947-4715-8fc9-d0048369a0d0',
    )
    expect(deps.upsertSyncedNote).toHaveBeenCalledWith('alice', 'activity', 'act-9', 'gravl', undefined)
    expect(deps.materializeSuperseded).toHaveBeenCalledWith('alice', startTime)
    expect(deps.auditInfo).toHaveBeenCalledWith(
      'alice',
      'sync',
      expect.stringContaining('set-less'),
      expect.objectContaining({
        activity_id: 'act-9',
        workout_id: '97248067-7947-4715-8fc9-d0048369a0d0',
      }),
    )
    expect(deps.insertRawRecord).not.toHaveBeenCalled()
    expect(deps.insertActivity).not.toHaveBeenCalled()
  })

  it('leaves a Health Connect session stored under the Gravl identity alone', async () => {
    const deps = makeDeps({ data: { gravl_workout_id: 'x', metadata: {} }, id: 'act-hc' })
    expect(await processGravlWorkout('alice', detail({ exercises: [] }), deps)).toBe('skipped')
    expect(deps.softDeleteActivityByExternalId).not.toHaveBeenCalled()
    expect(deps.insertActivity).not.toHaveBeenCalled()
  })

  it('leaves a Health Connect session an old import merged empty sets into alone', async () => {
    const deps = makeDeps({
      data: { metadata: { dataOrigin: 'com.liteup.getgains' }, sets: [] },
      id: 'act-hc',
    })
    expect(await retractEmptyGravlImport('alice', WORKOUT_ID, deps)).toBe('skipped')
    expect(deps.softDeleteActivityByExternalId).not.toHaveBeenCalled()
    expect(deps.materializeSuperseded).not.toHaveBeenCalled()
  })

  it('leaves a row that already carries sets alone', async () => {
    const deps = makeDeps({ data: { sets: [{ exercise: 'Bench Press' }] }, id: 'act-full' })
    expect(await retractEmptyGravlImport('alice', WORKOUT_ID, deps)).toBe('skipped')
    expect(deps.softDeleteActivityByExternalId).not.toHaveBeenCalled()
    expect(deps.materializeSuperseded).not.toHaveBeenCalled()
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

  it('reports a re-processed Gravl row as updated, not enriched', async () => {
    const deps = makeDeps({ data: { sets: [] }, id: 'act-1' })
    expect(await processGravlWorkout('alice', detail(), deps)).toBe('updated')
  })

  it('restores a retracted empty import once the workout has sets, then upserts it', async () => {
    const deps = makeDeps({ data: { sets: [] }, id: 'act-9' })
    vi.mocked(deps.restoreEmptyImportTombstone).mockResolvedValue(true)

    expect(await processGravlWorkout('alice', detail(), deps)).toBe('updated')

    expect(deps.restoreEmptyImportTombstone).toHaveBeenCalledWith(
      'alice',
      'gravl',
      'gravl-workout-97248067-7947-4715-8fc9-d0048369a0d0',
    )
    expect(deps.restoreSetlessTombstone).not.toHaveBeenCalled()
    expect(vi.mocked(deps.restoreEmptyImportTombstone).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.findActivityByExternalId).mock.invocationCallOrder[0],
    )
    expect(deps.insertActivity).toHaveBeenCalled()
    expect(deps.materializeSuperseded).toHaveBeenCalledWith('alice', new Date('2026-09-03T05:16:12Z'))
    expect(deps.upsertSyncedNote).toHaveBeenCalledWith(
      'alice',
      'activity',
      'act-1',
      'gravl',
      expect.stringContaining('Bench Press'),
      new Date('2026-09-03T05:16:12Z'),
      new Date('2026-09-03T05:45:12Z'),
    )
  })

  it('reports skipped without a note when another tombstone blocks the write', async () => {
    const deps = makeDeps(null)
    vi.mocked(deps.insertActivity).mockResolvedValue(undefined as unknown as string)

    expect(await processGravlWorkout('alice', detail(), deps)).toBe('skipped')
    expect(deps.upsertSyncedNote).not.toHaveBeenCalled()
    expect(deps.materializeSuperseded).not.toHaveBeenCalled()
  })

  it('does not re-materialize supersession when nothing was restored', async () => {
    const deps = makeDeps(null)
    expect(await processGravlWorkout('alice', detail(), deps)).toBe('created')
    expect(deps.materializeSuperseded).not.toHaveBeenCalled()
  })

  it('treats external workouts by type, not by name, whatever the casing', () => {
    expect(isExternalWorkout({ type: 'external' })).toBe(true)
    expect(isExternalWorkout({ type: 'External' })).toBe(true)
    expect(isExternalWorkout({ type: 'newSaved' })).toBe(false)
  })
})

describe('isStrengthWorkout', () => {
  const summary: GravlWorkoutSummary = {
    calories: 210,
    durationMinutes: 29,
    endDate: '2026-09-03T05:45:12Z',
    exerciseCount: 2,
    id: WORKOUT_ID,
    name: 'Push day',
    notes: null,
    personalRecordCount: 1,
    startDate: '2026-09-03T05:16:12Z',
    type: 'today',
    volume: 3527.396,
  }

  it('accepts a Gravl-logged workout with sets, by summary or detail', () => {
    expect(isStrengthWorkout(summary)).toBe(true)
    expect(isStrengthWorkout(detail())).toBe(true)
  })

  it('rejects a plain external round-trip, whatever the casing', () => {
    expect(isStrengthWorkout({ ...summary, exerciseCount: 1, type: 'external', volume: 0 })).toBe(false)
    expect(isStrengthWorkout({ ...summary, exerciseCount: 0, type: 'external', volume: 0 })).toBe(false)
    expect(isStrengthWorkout(roundTrip())).toBe(false)
    expect(isStrengthWorkout({ ...roundTrip(), type: 'External' as GravlWorkoutDetail['type'] })).toBe(false)
  })

  it('accepts an external workout that may carry, or carries, logged sets', () => {
    expect(isStrengthWorkout({ ...summary, exerciseCount: 2, type: 'external', volume: 0 })).toBe(true)
    expect(isStrengthWorkout({ ...summary, exerciseCount: 1, type: 'external', volume: 5370 })).toBe(true)
    expect(isStrengthWorkout(loggedExternal())).toBe(true)
    expect(isStrengthWorkout({ ...loggedExternal(), type: 'External' as GravlWorkoutDetail['type'] })).toBe(
      true,
    )
  })

  it('rejects workouts without a logged set', () => {
    expect(isStrengthWorkout({ ...summary, exerciseCount: 0 })).toBe(false)
    expect(isStrengthWorkout(detail({ exercises: [] }))).toBe(false)
    expect(
      isStrengthWorkout(
        detail({ exercises: [{ exerciseId: 1, exerciseName: 'Squat', sets: [], supersetId: null }] }),
      ),
    ).toBe(false)
  })
})

describe('hasLoggedSets', () => {
  const withSets = (...sets: GravlSet[]) => detail({ exercises: [exercise('Any', sets)] })

  it('counts a set with reps, weight or time alone as logged', () => {
    expect(hasLoggedSets(withSets(set({ reps: 12 })))).toBe(true)
    expect(hasLoggedSets(withSets(set({ weight: 45 })))).toBe(true)
    expect(hasLoggedSets(withSets(set({ duration: 60 })))).toBe(true)
  })

  it('does not count the cardio pseudo-set, duration with distance', () => {
    expect(hasLoggedSets(withSets(set({ distance: 2400, duration: 1800 })))).toBe(false)
    expect(hasLoggedSets(roundTrip())).toBe(false)
  })

  it('finds a real set next to the pseudo-exercise', () => {
    expect(hasLoggedSets(loggedExternal())).toBe(true)
  })

  it('finds nothing in a workout without sets', () => {
    expect(hasLoggedSets(detail({ exercises: [] }))).toBe(false)
    expect(hasLoggedSets(withSets())).toBe(false)
    expect(hasLoggedSets(withSets(set()))).toBe(false)
  })
})

describe('mayCarryLoggedSets', () => {
  const summary = (exerciseCount: number, volume: number) => ({ exerciseCount, volume })

  it('holds for two or more exercises, or one with a positive volume', () => {
    expect(mayCarryLoggedSets(summary(2, 0))).toBe(true)
    expect(mayCarryLoggedSets(summary(4, 5370))).toBe(true)
    expect(mayCarryLoggedSets(summary(1, 5370))).toBe(true)
  })

  it('does not hold for the lone pseudo-exercise or nothing at all', () => {
    expect(mayCarryLoggedSets(summary(1, 0))).toBe(false)
    expect(mayCarryLoggedSets(summary(0, 0))).toBe(false)
    expect(mayCarryLoggedSets(summary(0, 100))).toBe(false)
  })
})
