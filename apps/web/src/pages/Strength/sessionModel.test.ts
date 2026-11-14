import { describe, expect, it } from 'vitest'

import {
  addBlock,
  appendSets,
  blockSummary,
  blocksFromSets,
  clearSavedExerciseKeys,
  deleteSet,
  exerciseNames,
  expandQuickEntry,
  isDirty,
  isInProgress,
  isTimedBlock,
  liveDraftFromServer,
  logSet,
  moveBlock,
  nextSetPrefill,
  planFromSession,
  removeBlock,
  sessionSummary,
  setLabel,
  setsFromBlocks,
  setsOfData,
  setsOfExercise,
  supersetBlockIds,
  updateSet,
  withExerciseKeys,
  type ExerciseBlock,
} from './sessionModel'

const ids = () => {
  let n = 0
  return () => `id${++n}`
}

const block = (
  exercise: string,
  sets: Record<string, unknown>[] = [],
  extra: Partial<ExerciseBlock> = {},
) => ({
  exercise,
  id: exercise,
  planned: [],
  sets,
  ...extra,
})

describe('blocksFromSets and setsFromBlocks', () => {
  const sets = [
    { exercise: 'Bench press', reps: 8, weight: 60 },
    { exercise: 'bench press', reps: 8, superset_id: 's1', weight: 60 },
    { exercise: 'Pull-up', exercise_id: 'gravl-9', reps: 6 },
    { exercise: 'Bench Press', reps: 10, weight: 50 },
  ]

  it('groups consecutive sets of the same name and keeps a returning exercise as its own block', () => {
    const blocks = blocksFromSets(sets, ids())
    expect(blocks.map((b) => [b.id, b.exercise, b.sets.length])).toEqual([
      ['id1', 'Bench press', 2],
      ['id2', 'Pull-up', 1],
      ['id3', 'Bench Press', 1],
    ])
  })

  it('round-trips the flat list with order and unknown keys untouched', () => {
    expect(setsFromBlocks(blocksFromSets(sets, ids()))).toEqual(sets)
  })

  it('gives no blocks for no sets', () => {
    expect(blocksFromSets([], ids())).toEqual([])
  })
})

describe('setsOfData', () => {
  it('keeps only object rows of data.sets', () => {
    expect(setsOfData({ sets: [{ reps: 1 }, null, 3, [1]] })).toEqual([{ reps: 1 }])
    expect(setsOfData({})).toEqual([])
    expect(setsOfData(undefined)).toEqual([])
  })
})

describe('block editing', () => {
  const blocks = [block('A', [{ exercise: 'A', reps: 5 }]), block('B'), block('C')]

  it('adds a block with an optional catalogue key', () => {
    const next = addBlock([], 'Squat', 'barbell_squat', ids())
    expect(next).toEqual([
      { catalog_key: 'barbell_squat', exercise: 'Squat', id: 'id1', planned: [], sets: [] },
    ])
    expect(addBlock([], 'Squat', undefined, ids())[0]).not.toHaveProperty('catalog_key')
  })

  it('removes a block', () => {
    expect(removeBlock(blocks, 'B').map((b) => b.id)).toEqual(['A', 'C'])
  })

  it('moves a block up and down and ignores moves past the ends', () => {
    expect(moveBlock(blocks, 'B', -1).map((b) => b.id)).toEqual(['B', 'A', 'C'])
    expect(moveBlock(blocks, 'B', 1).map((b) => b.id)).toEqual(['A', 'C', 'B'])
    expect(moveBlock(blocks, 'A', -1)).toBe(blocks)
    expect(moveBlock(blocks, 'C', 1)).toBe(blocks)
  })

  it('logs a set with the block name and drops the first planned set', () => {
    const planned = [
      block('A', [], {
        planned: [
          { reps: 8, weight: 80 },
          { reps: 6, weight: 85 },
        ],
      }),
    ]
    const next = logSet(planned, 'A', { reps: 8, rpe: undefined, weight: 80 })
    expect(next[0].sets).toEqual([{ exercise: 'A', reps: 8, weight: 80 }])
    expect(next[0].planned).toEqual([{ reps: 6, weight: 85 }])
  })

  it('appends several sets at once', () => {
    const next = appendSets([block('A')], 'A', expandQuickEntry(2, 8, 60))
    expect(next[0].sets).toEqual([
      { exercise: 'A', reps: 8, weight: 60 },
      { exercise: 'A', reps: 8, weight: 60 },
    ])
  })

  it('updates a set in place, removing cleared fields and keeping unknown ones', () => {
    const start = [block('A', [{ exercise: 'A', reps: 5, rpe: 8, superset_id: 's', weight: 60 }])]
    const next = updateSet(start, 'A', 0, { rpe: undefined, weight: 62.5 })
    expect(next[0].sets[0]).toEqual({ exercise: 'A', reps: 5, superset_id: 's', weight: 62.5 })
  })

  it('deletes a set', () => {
    const start = [block('A', [{ reps: 1 }, { reps: 2 }, { reps: 3 }])]
    expect(deleteSet(start, 'A', 1)[0].sets).toEqual([{ reps: 1 }, { reps: 3 }])
  })
})

describe('expandQuickEntry', () => {
  it('makes that many equal rows', () => {
    expect(expandQuickEntry(3, 8, 60)).toEqual([
      { reps: 8, weight: 60 },
      { reps: 8, weight: 60 },
      { reps: 8, weight: 60 },
    ])
  })

  it('leaves out a missing weight and makes nothing for a bad count', () => {
    expect(expandQuickEntry(1, 10)).toEqual([{ reps: 10 }])
    expect(expandQuickEntry(0, 8, 60)).toEqual([])
    expect(expandQuickEntry(1.5, 8, 60)).toEqual([])
  })
})

describe('nextSetPrefill', () => {
  const lastTime = [
    { reps: 10, rpe: 7, weight: 50 },
    { reps: 9, weight: 55 },
  ]

  it('takes the previous set of the block, only weight, reps and time', () => {
    const b = block('A', [{ exercise: 'A', note: 'x', reps: 8, rpe: 9, set_type: 'failure', weight: 80 }])
    expect(nextSetPrefill(b, lastTime)).toEqual({ reps: 8, weight: 80 })
  })

  it('takes the planned set when nothing is logged yet', () => {
    expect(nextSetPrefill(block('A', [], { planned: [{ reps: 5, weight: 100 }] }), lastTime)).toEqual({
      reps: 5,
      weight: 100,
    })
  })

  it('takes last time’s set at that index, else nothing', () => {
    expect(nextSetPrefill(block('A'), lastTime)).toEqual({ reps: 10, weight: 50 })
    expect(nextSetPrefill(block('A'))).toEqual({})
  })
})

describe('isTimedBlock', () => {
  it('is timed when the latest set has a time and no reps', () => {
    expect(isTimedBlock(block('Plank', [{ time: 60 }]))).toBe(true)
    expect(isTimedBlock(block('Plank'), [{ time: 45 }])).toBe(true)
    expect(isTimedBlock(block('Row', [{ reps: 8, time: 30 }]))).toBe(false)
    expect(isTimedBlock(block('Row'))).toBe(false)
  })
})

describe('labels and summaries', () => {
  it('labels a set', () => {
    expect(setLabel({ reps: 8, weight: 80 })).toBe('80 kg × 8')
    expect(setLabel({ reps: 12 })).toBe('12 reps')
    expect(setLabel({ time: 72 })).toBe('1:12')
    expect(setLabel({ reps: 10, set_type: 'warmup', weight: 40 })).toBe('40 kg × 10 (warmup)')
    expect(setLabel({})).toBe('—')
  })

  it('summarises a block', () => {
    expect(blockSummary(block('A', [{ reps: 9 }, { reps: 8 }, { reps: 7 }]))).toBe('3 sets: 9, 8, 7 reps')
    expect(blockSummary(block('A', [{ time: 60 }]))).toBe('1 set: 1:00')
    expect(blockSummary(block('A'))).toBe('No sets yet')
    expect(blockSummary(block('A', [], { planned: [{ reps: 1 }, { reps: 2 }] }))).toBe('2 sets planned')
  })

  it('summarises a session by exercises and sets with sets logged', () => {
    const blocks = [block('A', [{}, {}]), block('B', [{}]), block('a', [{}]), block('C')]
    expect(sessionSummary(blocks)).toBe('2 exercises, 4 sets')
    expect(sessionSummary([block('A', [{}])])).toBe('1 exercise, 1 set')
  })

  it('lists exercise names once, in order', () => {
    expect(exerciseNames([{ exercise: 'A' }, { exercise: 'B' }, { exercise: 'a' }, {}])).toEqual(['A', 'B'])
  })
})

describe('planFromSession', () => {
  it('turns the source sets into planned sets of empty blocks', () => {
    const plan = planFromSession(
      [
        { exercise: 'A', note: 'n', reps: 8, weight: 80 },
        { exercise: 'A', reps: 8, weight: 80 },
        { exercise: 'B', time: 60 },
      ],
      ids(),
    )
    expect(plan).toEqual([
      {
        exercise: 'A',
        id: 'id1',
        planned: [
          { reps: 8, weight: 80 },
          { reps: 8, weight: 80 },
        ],
        sets: [],
      },
      { exercise: 'B', id: 'id2', planned: [{ time: 60 }], sets: [] },
    ])
  })
})

describe('exercise keys', () => {
  const blocks = [
    block('Squat', [{ exercise: 'Squat', reps: 5 }], { catalog_key: 'barbell_squat' }),
    block('Row', [], { catalog_key: 'cable_row' }),
    block('Dip', [{ exercise: 'Dip', reps: 5 }]),
  ]

  it('sends exercise_key with every set of a block that has one', () => {
    expect(withExerciseKeys(blocks)).toEqual([
      { exercise: 'Squat', exercise_key: 'barbell_squat', reps: 5 },
      { exercise: 'Dip', reps: 5 },
    ])
  })

  it('forgets a key once a save carried a set of its block', () => {
    const next = clearSavedExerciseKeys(blocks, blocks)
    expect(next[0]).not.toHaveProperty('catalog_key')
    expect(next[1].catalog_key).toBe('cable_row')
  })
})

describe('draft state', () => {
  it('is dirty while the revision is ahead of the saved one', () => {
    expect(isDirty({ rev: 2, saved_rev: 1 })).toBe(true)
    expect(isDirty({ rev: 2, saved_rev: 2 })).toBe(false)
  })

  it('reads in_progress strictly', () => {
    expect(isInProgress({ in_progress: true })).toBe(true)
    expect(isInProgress({ in_progress: 'yes' })).toBe(false)
    expect(isInProgress(undefined)).toBe(false)
  })

  it('builds a live draft from a saved session', () => {
    const draft = liveDraftFromServer(
      {
        data: {
          in_progress: true,
          last_set_at: '2026-11-10T17:30:00.000Z',
          sets: [{ exercise: 'A', reps: 5 }],
        },
        id: 'act1',
        start_time: '2026-11-10T17:02:00.000Z',
      },
      ids(),
    )
    expect(draft).toEqual({
      blocks: [{ exercise: 'A', id: 'id1', planned: [], sets: [{ exercise: 'A', reps: 5 }] }],
      current_block_id: 'id1',
      id: 'act1',
      last_set_at: '2026-11-10T17:30:00.000Z',
      rev: 0,
      saved_rev: 0,
      start_time: '2026-11-10T17:02:00.000Z',
    })
  })
})

describe('supersetBlockIds', () => {
  it('marks blocks whose sets share a superset id with another block', () => {
    const blocks = [
      block('A', [{ superset_id: 's1' }]),
      block('B', [{ superset_id: 's1' }]),
      block('C', [{ superset_id: 's2' }, { superset_id: 's2' }]),
      block('D', [{}]),
    ]
    expect([...supersetBlockIds(blocks)].sort()).toEqual(['A', 'B'])
  })
})

describe('setsOfExercise', () => {
  it('collects the sets of every block of that exercise', () => {
    const blocks = [
      block('A', [{ reps: 1 }]),
      block('B', [{ reps: 2 }]),
      { ...block('a', [{ reps: 3 }]), id: 'a2' },
    ]
    expect(setsOfExercise(blocks, 'A')).toEqual([{ reps: 1 }, { reps: 3 }])
  })
})
