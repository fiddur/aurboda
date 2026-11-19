import { describe, expect, test } from 'vitest'

import { MEMBER_COLORS, memberColor } from './member-colors'

const linear = (channel: number): number => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const oklab = (hex: string): [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map((i) => linear(Number.parseInt(hex.slice(i, i + 2), 16)))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

const distance = (a: string, b: string): number => {
  const [p, q] = [oklab(a), oklab(b)]
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

describe('memberColor', () => {
  test('every pair in the palette is far apart in OKLab, so lines can be told apart', () => {
    const pairs = MEMBER_COLORS.flatMap((a, i) => MEMBER_COLORS.slice(i + 1).map((b) => distance(a, b)))
    expect(Math.min(...pairs)).toBeGreaterThan(0.15)
  })

  test('the first eight members get eight distinct colours, the palette in order', () => {
    const firstRound = MEMBER_COLORS.map((_, i) => memberColor(i))
    expect(firstRound).toEqual([...MEMBER_COLORS])
    expect(new Set(firstRound).size).toBe(MEMBER_COLORS.length)
  })

  test('members nine to sixteen get the same hues lightened, distinct from the first round', () => {
    expect(memberColor(8)).toBe('#75c0c6')
    expect(memberColor(9)).toBe('#f9c060')
    expect(memberColor(15)).toBe('#c2995e')
    const sixteen = Array.from({ length: 16 }, (_, i) => memberColor(i))
    expect(new Set(sixteen).size).toBe(16)
  })

  test('cycles back to the palette after two rounds', () => {
    expect(memberColor(16)).toBe(MEMBER_COLORS[0])
    expect(memberColor(24)).toBe(memberColor(8))
  })
})
