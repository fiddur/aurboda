import { describe, expect, test } from 'vitest'

import { collapseOnsets, computeEventOutcome, parseLagDays } from './event-outcome.ts'

/** Build an inclusive range of YYYY-MM-DD day strings. */
const dayRange = (start: string, count: number): string[] => {
  const base = Date.parse(`${start}T00:00:00Z`)
  return Array.from({ length: count }, (_, i) =>
    new Date(base + i * 86_400_000).toISOString().split('T')[0],
  )
}

describe('parseLagDays', () => {
  test('parses hours rounding up to whole days', () => {
    expect(parseLagDays('12h')).toBe(1)
    expect(parseLagDays('24h')).toBe(1)
    expect(parseLagDays('36h')).toBe(2)
    expect(parseLagDays('48h')).toBe(2)
    expect(parseLagDays('72h')).toBe(3)
  })

  test('parses days', () => {
    expect(parseLagDays('7d')).toBe(7)
    expect(parseLagDays('1d')).toBe(1)
  })

  test('returns null for garbage', () => {
    expect(parseLagDays('soon')).toBeNull()
  })
})

describe('collapseOnsets', () => {
  test('collapses a contiguous multi-day flare to one onset', () => {
    // Days 1..6 contiguous -> single onset at day 1.
    expect(collapseOnsets([1, 2, 3, 4, 5, 6], 3)).toEqual([1])
  })

  test('splits episodes separated by more than the gap', () => {
    // 10,11 are one episode; 16 is 5 days after 11 (> gap 3) -> new onset.
    expect(collapseOnsets([10, 11, 16], 3)).toEqual([10, 16])
  })

  test('chained days within the gap stay one episode even past total span', () => {
    // Each step <= gap, so the whole chain collapses to the first day.
    expect(collapseOnsets([10, 11, 14], 3)).toEqual([10])
  })

  test('handles unsorted, duplicate input', () => {
    expect(collapseOnsets([5, 1, 5, 2], 3)).toEqual([1])
  })

  test('empty input', () => {
    expect(collapseOnsets([], 3)).toEqual([])
  })
})

describe('computeEventOutcome', () => {
  test('multi-day flare collapses so episodes do not dominate', () => {
    const known = dayRange('2024-01-01', 30)
    // One 5-day flare; trigger on the day before it starts.
    const outcomeDays = dayRange('2024-01-10', 5)
    const triggerDays = ['2024-01-09']

    const result = computeEventOutcome({
      triggerDays,
      outcomeDays,
      knownDays: known,
      lagWindows: ['48h'],
      collapseGapDays: 3,
    })

    expect(result.outcome_days).toBe(5)
    expect(result.onsets).toBe(1) // collapsed
  })

  test('detects exposure enrichment with reverse conditional and base rate', () => {
    // 100 known days. 10 onsets, 8 of which have a trigger the day before.
    // Triggers are otherwise rare, so the base rate of exposure is low.
    const known = dayRange('2024-01-01', 100)
    const onsetDays = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95].map(
      (d) => known[d],
    )
    // Trigger one day before 8 of the onsets; 2 onsets are unexposed.
    const triggerDays = [9, 19, 29, 39, 49, 59, 69, 79].map((d) => known[d])

    const result = computeEventOutcome({
      triggerDays,
      outcomeDays: onsetDays,
      knownDays: known,
      lagWindows: ['48h'],
      collapseGapDays: 3,
    })

    const lag = result.per_lag[0]
    expect(result.onsets).toBe(10)
    // 48h = 2-day window ending on the onset, so the day-before trigger counts.
    expect(lag.onsets_exposed).toBe(8)
    expect(lag.reverse_conditional).toBeCloseTo(0.8, 5)
    // Base rate of exposure is far below 0.8 -> strong enrichment.
    expect(lag.base_rate).toBeLessThan(0.3)
    expect(lag.relative_risk).not.toBeNull()
    expect(lag.relative_risk!).toBeGreaterThan(2)
    expect(lag.p_value).toBeLessThan(0.05)
  })

  test('no real effect -> relative risk near 1, not significant', () => {
    // Triggers and onsets both spread evenly and independently.
    const known = dayRange('2024-01-01', 120)
    const onsetDays = Array.from({ length: 12 }, (_, i) => known[i * 10])
    const triggerDays = Array.from({ length: 12 }, (_, i) => known[i * 10 + 5])

    const result = computeEventOutcome({
      triggerDays,
      outcomeDays: onsetDays,
      knownDays: known,
      lagWindows: ['24h'],
      collapseGapDays: 3,
    })

    const lag = result.per_lag[0]
    // With 24h (same-day) exposure and offset triggers, no onset is exposed.
    expect(lag.onsets_exposed).toBe(0)
    expect(lag.p_value).toBeGreaterThan(0.05)
  })

  test('known-day denominator excludes onsets outside the known window', () => {
    // Outcome on a day that is not in knownDays is ignored.
    const known = dayRange('2024-02-01', 10)
    const result = computeEventOutcome({
      triggerDays: ['2024-02-02'],
      outcomeDays: ['2024-02-03', '2024-01-15'], // second is outside known window
      knownDays: known,
      lagWindows: ['48h'],
      collapseGapDays: 3,
    })
    expect(result.onsets).toBe(1)
    expect(result.per_lag[0].known_days).toBe(10)
  })

  test('reproduces a weak ejaculation<->back_pain-style signal (~1.5x, n.s.)', () => {
    // Synthetic 2-year known window. back_pain flares roughly monthly; trigger
    // ("leak") is common, so the base rate of exposure is high. Only half the
    // flares have a day-before trigger beyond chance. With a proper known-day
    // denominator this should look like a modest ~1.5x and NOT be significant,
    // matching the issue's full-log finding.
    const known = dayRange('2022-01-01', 730)
    // 24 flares, one every 30 days (onset days are residue 0 mod 5).
    const onsetDays = Array.from({ length: 24 }, (_, i) => known[15 + 30 * i])
    // Common background trigger every ~5th day, placed so it never lands in an
    // onset's 48h window (residue 2 mod 5 -> exposes residues 2 and 3 only).
    const triggerDays = known.filter((_, i) => i % 5 === 2)
    // A genuine day-before trigger for half the flares (even i).
    for (let i = 0; i < 24; i += 2) triggerDays.push(known[15 + 30 * i - 1])

    const result = computeEventOutcome({
      triggerDays,
      outcomeDays: onsetDays,
      knownDays: known,
      lagWindows: ['48h'],
      collapseGapDays: 3,
    })

    const lag = result.per_lag[0]
    expect(result.onsets).toBe(24)
    // Exactly the 12 flares with a real day-before trigger are exposed.
    expect(lag.onsets_exposed).toBe(12)
    expect(lag.reverse_conditional).toBeCloseTo(0.5, 5)
    expect(lag.relative_risk).not.toBeNull()
    // Modest enrichment, not a strong one.
    expect(lag.relative_risk!).toBeGreaterThan(1.0)
    expect(lag.relative_risk!).toBeLessThan(2.0)
    // Base rate is substantial because the trigger is common.
    expect(lag.base_rate).toBeGreaterThan(0.3)
    // Not significant against such a high base rate.
    expect(lag.p_value).toBeGreaterThan(0.05)
  })

  test('handles multi-year window without timing out', () => {
    const known = dayRange('2018-01-01', 2200)
    const onsetDays = Array.from({ length: 200 }, (_, i) => known[i * 10])
    const triggerDays = known.filter((_, i) => i % 4 === 0)

    const start = performance.now()
    const result = computeEventOutcome({
      triggerDays,
      outcomeDays: onsetDays,
      knownDays: known,
      lagWindows: ['24h', '48h', '7d'],
      collapseGapDays: 3,
    })
    const elapsed = performance.now() - start

    expect(result.per_lag).toHaveLength(3)
    expect(elapsed).toBeLessThan(500)
  })
})
