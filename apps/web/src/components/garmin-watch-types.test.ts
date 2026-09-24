import type { GarminWatchType } from '@aurboda/api-spec'

import { garminSports } from '@aurboda/api-spec'
import { describe, expect, it } from 'vitest'

import {
  addWatchType,
  moveWatchType,
  nextWatchTypeCode,
  parseSportOptionValue,
  removeWatchType,
  renameWatchType,
  setWatchTypeSport,
  sportOptionsFor,
  sportOptionValue,
} from './garmin-watch-types'

const entry = (activity_type: string, code: number, session_name = activity_type): GarminWatchType => ({
  activity_type,
  code,
  fit_sport: 0,
  fit_sub_sport: 0,
  session_name,
})

const types = [entry('yoga', 1), entry('meditation', 4), entry('reading', 2)]
const order = (list: GarminWatchType[]) => list.map((t) => t.activity_type)

describe('nextWatchTypeCode', () => {
  it('starts at 1 for an empty list', () => {
    expect(nextWatchTypeCode([])).toBe(1)
  })

  it('is one above the highest existing code', () => {
    expect(nextWatchTypeCode(types)).toBe(5)
  })
})

describe('addWatchType', () => {
  it('appends with the next code, the suggested sport and the display name as label', () => {
    const next = addWatchType(types, 'strength_training', 'Strength training')
    expect(next.at(-1)).toEqual({
      activity_type: 'strength_training',
      code: 5,
      fit_sport: 10,
      fit_sub_sport: 20,
      session_name: 'Strength training',
    })
    expect(next).toHaveLength(4)
  })

  it('uses the generic sport for a type without a Garmin counterpart', () => {
    const [added] = addWatchType([], 'journaling', 'Journaling')
    expect(added).toMatchObject({ code: 1, fit_sport: 0, fit_sub_sport: 0 })
  })

  it('cuts the label to 20 characters', () => {
    const [added] = addWatchType([], 'long_type', 'A very long activity type name')
    expect(added.session_name).toBe('A very long activity')
  })

  it('falls back to the type name when the display name is blank', () => {
    const [added] = addWatchType([], 'reading', '  ')
    expect(added.session_name).toBe('reading')
  })

  it('leaves the list unchanged when the type is already there', () => {
    expect(addWatchType(types, 'yoga', 'Yoga')).toBe(types)
  })

  it('leaves the list unchanged for an empty type', () => {
    expect(addWatchType(types, '', '')).toBe(types)
  })
})

describe('moveWatchType', () => {
  it('moves a type up', () => {
    expect(order(moveWatchType(types, 'reading', -1))).toEqual(['yoga', 'reading', 'meditation'])
  })

  it('moves a type down', () => {
    expect(order(moveWatchType(types, 'yoga', 1))).toEqual(['meditation', 'yoga', 'reading'])
  })

  it('does not move past either end', () => {
    expect(moveWatchType(types, 'yoga', -1)).toBe(types)
    expect(moveWatchType(types, 'reading', 1)).toBe(types)
  })

  it('ignores an unknown type', () => {
    expect(moveWatchType(types, 'running', 1)).toBe(types)
  })

  it('keeps codes with their types', () => {
    const moved = moveWatchType(types, 'reading', -2)
    expect(moved.map((t) => t.code)).toEqual([2, 1, 4])
  })
})

describe('removeWatchType', () => {
  it('removes the type and keeps the others in order', () => {
    expect(order(removeWatchType(types, 'meditation'))).toEqual(['yoga', 'reading'])
  })
})

describe('renameWatchType', () => {
  it('sets a trimmed label', () => {
    const next = renameWatchType(types, 'yoga', '  Morning yoga ')
    expect(next[0].session_name).toBe('Morning yoga')
    expect(next[1]).toBe(types[1])
  })

  it('cuts the label to 20 characters', () => {
    expect(renameWatchType(types, 'yoga', 'x'.repeat(30))[0].session_name).toHaveLength(20)
  })

  it('ignores a blank label', () => {
    expect(renameWatchType(types, 'yoga', '   ')).toBe(types)
  })
})

describe('setWatchTypeSport', () => {
  it('sets sport and sub-sport of the one type', () => {
    const next = setWatchTypeSport(types, 'meditation', 67, 0)
    expect(next[1]).toMatchObject({ code: 4, fit_sport: 67, fit_sub_sport: 0 })
    expect(next[0]).toBe(types[0])
  })
})

describe('sport option values', () => {
  it('round-trips sport and sub-sport', () => {
    expect(parseSportOptionValue(sportOptionValue(10, 43))).toEqual({ sport: 10, sub_sport: 43 })
  })

  it('rejects malformed values', () => {
    expect(parseSportOptionValue('10')).toBeUndefined()
    expect(parseSportOptionValue('a/b')).toBeUndefined()
  })
})

describe('sportOptionsFor', () => {
  it('is the curated list when the pair is in it', () => {
    expect(sportOptionsFor(10, 43)).toBe(garminSports)
  })

  it('adds an unknown pair as an extra option', () => {
    const options = sportOptionsFor(99, 7)
    expect(options).toHaveLength(garminSports.length + 1)
    expect(options.at(-1)).toEqual({ label: 'Sport 99/7', sport: 99, sub_sport: 7 })
  })
})
