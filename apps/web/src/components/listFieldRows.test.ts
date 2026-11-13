import { describe, expect, test } from 'vitest'

import {
  addRowLabel,
  dropBlankListRows,
  MAIN_ITEM_FIELDS,
  mainItemFields,
  moveRow,
  newRow,
  removeRow,
  setCell,
  visibleItemFields,
} from './listFieldRows'

const itemFields = [
  { name: 'exercise', type: 'string' as const },
  { name: 'weight', type: 'number' as const },
  { name: 'reps', type: 'number' as const },
]

const setFields = [
  { name: 'exercise', required: true, type: 'string' as const },
  { name: 'weight', type: 'number' as const },
  { name: 'reps', type: 'number' as const },
  { name: 'time', type: 'number' as const },
  { enum_values: ['normal', 'warmup'], name: 'set_type', type: 'string' as const },
  { name: 'rpe', type: 'number' as const },
  { name: 'note', type: 'string' as const },
]

describe('newRow', () => {
  test('is empty without a previous row', () => {
    expect(newRow(undefined, itemFields)).toEqual({})
  })

  test('copies the declared values of the previous row, not its undeclared keys or blanks', () => {
    const previous = { exercise: 'Bench press', exercise_id: 'x1', order: 3, reps: null, weight: 80 }
    expect(newRow(previous, itemFields)).toEqual({ exercise: 'Bench press', weight: 80 })
  })

  test('copies only the main item fields, not a secondary one', () => {
    const previous = { exercise: 'Squat', note: 'slow', reps: 5, set_type: 'warmup', time: 30, weight: 60 }
    expect(newRow(previous, setFields)).toEqual({ exercise: 'Squat', reps: 5, time: 30, weight: 60 })
  })
})

describe('mainItemFields', () => {
  test('is every item field when there are no more than the main count', () => {
    expect(MAIN_ITEM_FIELDS).toBe(4)
    expect(mainItemFields(itemFields)).toEqual(itemFields)
  })

  test('is the first four plus any required one, in declared order', () => {
    const fields = [...setFields.slice(0, 5), { name: 'side', required: true, type: 'string' as const }]
    expect(mainItemFields(fields).map((f) => f.name)).toEqual(['exercise', 'weight', 'reps', 'time', 'side'])
  })
})

describe('visibleItemFields', () => {
  const names = (fields: { name: string }[]) => fields.map((f) => f.name)

  test('hides nothing in a list of four or fewer item fields', () => {
    expect(visibleItemFields(itemFields, [], false)).toEqual(itemFields)
  })

  test('hides the secondary fields until a row has a value for one', () => {
    expect(
      names(visibleItemFields(setFields, [{ exercise: 'Squat', note: '  ', set_type: null }], false)),
    ).toEqual(['exercise', 'weight', 'reps', 'time'])
    expect(names(visibleItemFields(setFields, [{ exercise: 'Squat' }, { note: 'slow' }], false))).toEqual([
      'exercise',
      'weight',
      'reps',
      'time',
      'note',
    ])
  })

  test('shows every item field when expanded', () => {
    expect(visibleItemFields(setFields, [], true)).toEqual(setFields)
  })
})

describe('moveRow', () => {
  const rows = [{ a: 1 }, { a: 2 }, { a: 3 }]

  test('swaps a row with its neighbour', () => {
    expect(moveRow(rows, 1, -1)).toEqual([{ a: 2 }, { a: 1 }, { a: 3 }])
    expect(moveRow(rows, 1, 1)).toEqual([{ a: 1 }, { a: 3 }, { a: 2 }])
  })

  test('leaves the rows alone at the edges', () => {
    expect(moveRow(rows, 0, -1)).toEqual(rows)
    expect(moveRow(rows, 2, 1)).toEqual(rows)
  })

  test('does not mutate its input', () => {
    moveRow(rows, 0, 1)
    expect(rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
  })
})

describe('removeRow', () => {
  test('drops the row at the index', () => {
    expect(removeRow([{ a: 1 }, { a: 2 }, { a: 3 }], 1)).toEqual([{ a: 1 }, { a: 3 }])
  })
})

describe('setCell', () => {
  test('sets one value and keeps the undeclared keys of the row', () => {
    const rows = [{ exercise: 'Squat', exercise_id: 'x1' }, { exercise: 'Row' }]
    expect(setCell(rows, 0, 'weight', 100)).toEqual([
      { exercise: 'Squat', exercise_id: 'x1', weight: 100 },
      { exercise: 'Row' },
    ])
  })
})

describe('addRowLabel', () => {
  test('uses the singular of the label', () => {
    expect(addRowLabel('Sets')).toBe('+ Add set')
    expect(addRowLabel('Exercise')).toBe('+ Add exercise')
  })

  test('falls back to row', () => {
    expect(addRowLabel('')).toBe('+ Add row')
    expect(addRowLabel('s')).toBe('+ Add row')
  })
})

describe('dropBlankListRows', () => {
  const schema = {
    fields: [
      { name: 'kind', type: 'string' as const },
      { item_fields: itemFields, name: 'sets', type: 'list' as const },
    ],
  }

  test('drops rows whose declared values are all blank and keeps the rest of the data', () => {
    const data = {
      kind: 'push',
      sets: [{ exercise: 'Squat', reps: 5 }, { exercise: null, reps: '  ' }, { exercise_id: 7 }, {}],
    }
    expect(dropBlankListRows(schema, data)).toEqual({ kind: 'push', sets: [{ exercise: 'Squat', reps: 5 }] })
  })

  test('returns the same object when nothing is blank, without a schema, or when the value is not an array', () => {
    const data = { kind: 'push', sets: [{ exercise: 'Squat' }] }
    expect(dropBlankListRows(schema, data)).toBe(data)
    expect(dropBlankListRows(undefined, data)).toBe(data)
    const text = { sets: 'Squat 5x5' }
    expect(dropBlankListRows(schema, text)).toBe(text)
  })
})
