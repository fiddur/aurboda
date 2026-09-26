import { describe, expect, test } from 'vitest'

import { mergeHistograms, summarizeHistogram } from './value-histogram.ts'

/** percentile_cont / fiveNumberSummary over the raw samples. */
const quantile = (sorted: number[], p: number): number => {
  const idx = p * (sorted.length - 1)
  const lo = Math.floor(idx)
  return sorted[lo]! + (sorted[Math.ceil(idx)]! - sorted[lo]!) * (idx - lo)
}

const histogramOf = (values: number[]) => {
  const h = new Map<number, number>()
  for (const v of values) h.set(v, (h.get(v) ?? 0) + 1)
  return h
}

describe('summarizeHistogram', () => {
  test('equals the quartiles and mean of the samples it counts', () => {
    let seed = 11
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (const size of [1, 2, 3, 4, 7, 100, 1001]) {
      const values = Array.from({ length: size }, () => Math.round(60 + next() * 120))
      const sorted = values.toSorted((a, b) => a - b)

      const summary = summarizeHistogram(histogramOf(values))!

      expect(summary.sample_count).toBe(size)
      expect(summary.min).toBe(sorted[0])
      expect(summary.max).toBe(sorted.at(-1))
      expect(summary.avg).toBeCloseTo(values.reduce((a, b) => a + b, 0) / size, 9)
      expect(summary.q1).toBeCloseTo(quantile(sorted, 0.25), 9)
      expect(summary.median).toBeCloseTo(quantile(sorted, 0.5), 9)
      expect(summary.q3).toBeCloseTo(quantile(sorted, 0.75), 9)
    }
  })

  test('an empty histogram has no summary', () => {
    expect(summarizeHistogram(new Map())).toBeUndefined()
    expect(summarizeHistogram(new Map([[100, 0]]))).toBeUndefined()
  })
})

describe('mergeHistograms', () => {
  test('adds counts per value', () => {
    expect(
      mergeHistograms([
        new Map([
          [100, 2],
          [110, 1],
        ]),
        new Map([[110, 3]]),
        new Map(),
      ]),
    ).toEqual(
      new Map([
        [100, 2],
        [110, 4],
      ]),
    )
  })
})
