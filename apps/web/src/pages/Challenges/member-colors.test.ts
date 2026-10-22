import { describe, expect, test } from 'vitest'

import { MEMBER_COLORS, memberColor } from './member-colors'

describe('memberColor', () => {
  test('the first eight members get eight distinct colours, the palette in order', () => {
    const firstRound = MEMBER_COLORS.map((_, i) => memberColor(i))
    expect(firstRound).toEqual([...MEMBER_COLORS])
    expect(new Set(firstRound).size).toBe(MEMBER_COLORS.length)
  })

  test('members nine to sixteen get the same hues lightened, distinct from the first round', () => {
    expect(memberColor(8)).toBe('#b495f9')
    expect(memberColor(9)).toBe('#64d2ad')
    expect(memberColor(15)).toBe('#afde68')
    const sixteen = Array.from({ length: 16 }, (_, i) => memberColor(i))
    expect(new Set(sixteen).size).toBe(16)
  })

  test('cycles back to the palette after two rounds', () => {
    expect(memberColor(16)).toBe(MEMBER_COLORS[0])
    expect(memberColor(24)).toBe(memberColor(8))
  })
})
