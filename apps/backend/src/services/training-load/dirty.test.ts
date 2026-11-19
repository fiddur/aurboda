import { describe, expect, test, vi } from 'vitest'

import type { WorkoutTypeDefinition } from '../workout-types.ts'

import {
  markWorkoutHoursDirty,
  trackWorkoutTypeChanges,
  type WorkoutDirtyDeps,
  workoutMembershipChanges,
} from './dirty.ts'
import { settleChunk, withDirtyMark } from './state.ts'

const def = (name: string, display_category: string, parent_type?: string): WorkoutTypeDefinition => ({
  display_category,
  name,
  parent_type,
})

const definitions = [def('running', 'exercise'), def('sauna', 'wellness'), def('padel', 'other')]

const makeDeps = (
  defs: WorkoutTypeDefinition[][] = [definitions],
  earliest?: Date,
): WorkoutDirtyDeps & { markImpulsesDirty: ReturnType<typeof vi.fn> } => {
  let reads = 0
  return {
    getActivityTypeDefinitions: vi.fn(async () => defs[Math.min(reads++, defs.length - 1)]!),
    getEarliestActivityStart: vi.fn(async () => earliest),
    markImpulsesDirty: vi.fn(async () => undefined),
  }
}

const at = (iso: string) => new Date(iso)

describe('markWorkoutHoursDirty', () => {
  test('a workout session marks from its start hour', async () => {
    const deps = makeDeps()
    await markWorkoutHoursDirty(
      'u',
      [{ activity_type: 'running', start_time: at('2026-11-01T10:42:00Z') }],
      deps,
    )
    expect(deps.markImpulsesDirty).toHaveBeenCalledExactlyOnceWith('u', at('2026-11-01T10:00:00Z'))
  })

  test('a session of another type marks nothing', async () => {
    const deps = makeDeps()
    await markWorkoutHoursDirty(
      'u',
      [{ activity_type: 'sauna', start_time: at('2026-11-01T10:42:00Z') }],
      deps,
    )
    expect(deps.markImpulsesDirty).not.toHaveBeenCalled()
  })

  test('of mixed sessions, the earliest workout counts', async () => {
    const deps = makeDeps()
    await markWorkoutHoursDirty(
      'u',
      [
        { activity_type: 'sauna', start_time: at('2026-10-01T08:00:00Z') },
        { activity_type: 'running', start_time: at('2026-11-02T07:15:00Z') },
        { activity_type: 'exercise', start_time: at('2026-11-01T18:05:00Z') },
      ],
      deps,
    )
    expect(deps.markImpulsesDirty).toHaveBeenCalledExactlyOnceWith('u', at('2026-11-01T18:00:00Z'))
  })

  test('a session that was a workout before the change counts', async () => {
    const deps = makeDeps()
    await markWorkoutHoursDirty(
      'u',
      [
        { activity_type: 'running', start_time: at('2026-11-01T10:00:00Z') },
        { activity_type: 'sauna', start_time: at('2026-11-03T10:00:00Z') },
      ],
      deps,
    )
    expect(deps.markImpulsesDirty).toHaveBeenCalledExactlyOnceWith('u', at('2026-11-01T10:00:00Z'))
  })

  test('a failure does not reach the caller', async () => {
    const deps = makeDeps()
    deps.markImpulsesDirty.mockRejectedValueOnce(new Error('db gone'))
    await expect(
      markWorkoutHoursDirty(
        'u',
        [{ activity_type: 'running', start_time: at('2026-11-01T10:00:00Z') }],
        deps,
      ),
    ).resolves.toBeUndefined()
  })
})

describe('workoutMembershipChanges', () => {
  test('a type moved into the exercise category, and its descendants, changed', () => {
    const before = [...definitions, def('beach_padel', 'other', 'padel')]
    const after = [def('running', 'exercise'), def('sauna', 'wellness'), def('padel', 'exercise'), before[3]!]
    expect(workoutMembershipChanges(before, after).sort()).toEqual(['beach_padel', 'padel'])
  })

  test('display changes change nothing', () => {
    expect(workoutMembershipChanges(definitions, definitions)).toEqual([])
  })

  test('a renamed workout type keeps its sessions workouts', () => {
    const after = [def('jogging', 'exercise'), def('sauna', 'wellness'), def('padel', 'other')]
    expect(workoutMembershipChanges(definitions, after, { from: 'running', to: 'jogging' })).toEqual([])
  })

  test('a workout type merged into another type moves its sessions out of the workouts', () => {
    const after = [def('sauna', 'wellness'), def('padel', 'other')]
    expect(workoutMembershipChanges(definitions, after, { from: 'running', to: 'padel' })).toEqual(['padel'])
  })
})

describe('trackWorkoutTypeChanges', () => {
  test('marks from the earliest session of a type that became a workout type', async () => {
    const after = [def('running', 'exercise'), def('sauna', 'wellness'), def('padel', 'exercise')]
    const deps = makeDeps([definitions, after], at('2025-02-03T04:05:00Z'))

    expect(await trackWorkoutTypeChanges('u', async () => 'done', undefined, deps)).toBe('done')

    expect(deps.getEarliestActivityStart).toHaveBeenCalledExactlyOnceWith('u', ['padel'])
    expect(deps.markImpulsesDirty).toHaveBeenCalledExactlyOnceWith('u', at('2025-02-03T04:00:00Z'))
  })

  test('marks nothing when no type changed', async () => {
    const deps = makeDeps([definitions, definitions], at('2025-02-03T04:05:00Z'))
    await trackWorkoutTypeChanges('u', async () => 'done', undefined, deps)
    expect(deps.getEarliestActivityStart).not.toHaveBeenCalled()
    expect(deps.markImpulsesDirty).not.toHaveBeenCalled()
  })
})

describe('settleChunk', () => {
  const currentHour = at('2026-11-18T12:00:00Z')
  const chunkEnd = at('2026-11-10T00:00:00Z')

  test('without a mark since the chunk began, the watermark moves to its end', () => {
    expect(settleChunk({ impulse_dirty_rev: 2, impulse_watermark: 'x' }, 2, chunkEnd, currentHour)).toEqual({
      next: chunkEnd,
      settings: { impulse_dirty_rev: 2, impulse_watermark: chunkEnd.toISOString() },
    })
  })

  test('a mark after the chunk end leaves the watermark at the chunk end', () => {
    const marked = withDirtyMark({ impulse_dirty_rev: 2 }, at('2026-11-15T00:00:00Z'))
    expect(settleChunk(marked, 2, chunkEnd, currentHour)).toEqual({
      next: chunkEnd,
      settings: { ...marked, impulse_watermark: chunkEnd.toISOString() },
    })
  })

  test('at the current hour, a mark after the chunk is left as stored', () => {
    const marked = withDirtyMark({ impulse_dirty_rev: 2 }, at('2026-11-18T12:30:00Z'))
    expect(settleChunk(marked, 2, currentHour, currentHour)).toEqual({ next: currentHour, settings: marked })
  })
})
