import { describe, expect, test } from 'vitest'

import { parseNameList } from './data-presence.ts'

describe('parseNameList', () => {
  test('splits, trims, drops blanks and duplicates', () => {
    expect(parseNameList(' steps, hrv_rmssd,,steps ')).toEqual(['steps', 'hrv_rmssd'])
  })

  test('nothing asked is an empty list', () => {
    expect(parseNameList(undefined)).toEqual([])
    expect(parseNameList('')).toEqual([])
  })
})
