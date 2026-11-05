import { describe, expect, test, vi } from 'vitest'

import {
  type ExerciseShareDeps,
  type ExerciseShareSource,
  resolveExerciseShare,
} from './feed-exercise-share.ts'

const body: ExerciseShareSource = {
  activity_type: 'strength_training',
  field: 'sets.exercise',
  include_link: true,
  include_records: true,
  include_sessions: false,
  value: 'Bench Press',
}

const depsWith = (over: Partial<ExerciseShareDeps> = {}): ExerciseShareDeps => ({
  assertItemPath: vi.fn(async () => undefined),
  findSharedExercise: vi.fn(async () => null),
  hasSessions: vi.fn(async () => true),
  ...over,
})

const WEB = 'https://aurboda.example'

describe('resolveExerciseShare', () => {
  test('an unpublished exercise is named by its value and carries no link', async () => {
    expect(await resolveExerciseShare('fiddur', body, WEB, depsWith())).toEqual({
      exercise: {
        activity_type: 'strength_training',
        field: 'sets.exercise',
        include_records: true,
        include_sessions: false,
        name: 'Bench Press',
        value: 'Bench Press',
      },
      ok: true,
    })
  })

  test('a published exercise takes its name and links its public page', async () => {
    const deps = depsWith({ findSharedExercise: vi.fn(async () => ({ name: 'Bench', slug: 'bench-x1' })) })
    const resolved = await resolveExerciseShare('fiddur', body, WEB, deps)
    expect(deps.findSharedExercise).toHaveBeenCalledWith(
      'fiddur',
      'strength_training',
      'sets.exercise',
      'Bench Press',
    )
    expect(resolved.ok && resolved.exercise).toMatchObject({
      name: 'Bench',
      url: 'https://aurboda.example/u/fiddur/bench-x1',
    })
  })

  test('no link when it was not asked for, or without a web host', async () => {
    const deps = depsWith({ findSharedExercise: async () => ({ name: 'Bench', slug: 'bench-x1' }) })
    const unlinked = await resolveExerciseShare('fiddur', { ...body, include_link: false }, WEB, deps)
    expect(unlinked.ok && unlinked.exercise).not.toHaveProperty('url')
    expect(unlinked.ok && unlinked.exercise.name).toBe('Bench')
    const hostless = await resolveExerciseShare('fiddur', body, undefined, deps)
    expect(hostless.ok && hostless.exercise).not.toHaveProperty('url')
  })

  test('a rejected item path passes its status through', async () => {
    const deps = depsWith({ assertItemPath: async () => ({ error: 'not categorical', status: 400 }) })
    expect(await resolveExerciseShare('fiddur', body, WEB, deps)).toEqual({
      error: 'not categorical',
      ok: false,
      status: 400,
    })
    expect(deps.hasSessions).not.toHaveBeenCalled()
  })

  test('404 when no session has the exercise', async () => {
    const deps = depsWith({ hasSessions: async () => false })
    expect(await resolveExerciseShare('fiddur', body, WEB, deps)).toEqual({
      error: 'No sessions with that exercise',
      ok: false,
      status: 404,
    })
  })
})
