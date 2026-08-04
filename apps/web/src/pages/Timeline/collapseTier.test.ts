import { describe, expect, it } from 'vitest'

import { collapseDepthForPixelsPerHour, computePixelsPerHour, mergeGapForZoom } from './collapseTier'

const MINUTE = 60_000

describe('mergeGapForZoom', () => {
  it('keeps the coarse tiers for multi-week and multi-day views', () => {
    expect(mergeGapForZoom(60, 0.8)).toBe(4 * 60 * MINUTE)
    expect(mergeGapForZoom(3, 14)).toBe(60 * MINUTE)
  })

  it('matches the previous 10-minute floor at a 1000px day view', () => {
    // 24h in 1000px → ~41.7 pph, where 7px works out to ~10 min
    const dayView = mergeGapForZoom(0, computePixelsPerHour(1000, new Date(0), new Date(24 * 3_600_000)))
    expect(dayView / MINUTE).toBeCloseTo(10, 0)
  })

  it('pins the pixel gap itself, above the cap', () => {
    // The day-view assertion above is satisfied by the 10-minute cap, so it
    // holds for any MERGE_GAP_PX >= ~7. 84 pph is exactly 2x day zoom, where
    // 7px works out to an uncapped 5 min — so this fixes the constant.
    expect(mergeGapForZoom(0, 84) / MINUTE).toBe(5)
  })

  it('shrinks the gap as the user zooms in past a single day', () => {
    const dayView = mergeGapForZoom(0, 41.7)
    const hourView = mergeGapForZoom(0, 1000)

    expect(hourView).toBeLessThan(dayView)
    // Two sessions 9 min apart stay merged at day view but separate zoomed in
    expect(9 * MINUTE).toBeLessThan(dayView)
    expect(9 * MINUTE).toBeGreaterThan(hourView)
  })

  it('never bridges more than the previous 10-minute floor', () => {
    // The cap binds at low pixels-per-hour, not high: 1 pph is a 1000px container
    // showing ~1000 hours, and 0.001 pph is more extreme still. Both are
    // maximally zoomed-out or very narrow, where 7px is worth far more than
    // 10 minutes.
    expect(mergeGapForZoom(0, 1)).toBe(10 * MINUTE)
    expect(mergeGapForZoom(2, 0.001)).toBe(10 * MINUTE)
  })

  it('falls back to the floor when there is no zoom measurement yet', () => {
    for (const noMeasurement of [0, -1, Number.NaN]) {
      expect(mergeGapForZoom(0, noMeasurement)).toBe(10 * MINUTE)
    }
  })

  it('bridges nothing but touching spans at unbounded zoom', () => {
    expect(mergeGapForZoom(0, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('collapseDepthForPixelsPerHour (#658)', () => {
  it('returns 0 (no walk) for high pixels-per-hour — typical day view', () => {
    // 1000px container, 24h day → ~42 pph. Sub-types stay distinct.
    expect(collapseDepthForPixelsPerHour(42)).toBe(0)
    // Generous max-zoom: 1h in 1000px → 1000 pph.
    expect(collapseDepthForPixelsPerHour(1000)).toBe(0)
  })

  it('returns 1 (one hop) for medium pixels-per-hour — 3-14 day equivalent', () => {
    // 1000px container, 3-day view → ~14 pph.
    expect(collapseDepthForPixelsPerHour(14)).toBe(1)
    // Boundary at exactly 5 pph still falls in depth=1.
    expect(collapseDepthForPixelsPerHour(5)).toBe(1)
    // Lower bound of depth=0.
    expect(collapseDepthForPixelsPerHour(30)).toBe(1)
  })

  it('returns Infinity (walk to root) for low pixels-per-hour — broad multi-week view', () => {
    // 1000px container, 14-day view → ~3 pph.
    expect(collapseDepthForPixelsPerHour(3)).toBe(Number.POSITIVE_INFINITY)
    // 1000px, 30-day view → ~1.4 pph.
    expect(collapseDepthForPixelsPerHour(1.4)).toBe(Number.POSITIVE_INFINITY)
    // Just under the 5 pph threshold.
    expect(collapseDepthForPixelsPerHour(4.99)).toBe(Number.POSITIVE_INFINITY)
  })

  it('handles invalid / zero / negative inputs by returning 0', () => {
    // Pre-mount or pre-measure: container hasn't resolved yet. The safest
    // default is "show everything distinct" until we know the actual zoom.
    expect(collapseDepthForPixelsPerHour(0)).toBe(0)
    expect(collapseDepthForPixelsPerHour(-1)).toBe(0)
    expect(collapseDepthForPixelsPerHour(NaN)).toBe(0)
  })

  it('treats Infinity as max zoom (depth 0 via the > 30 branch, not the guard)', () => {
    // A degenerate visible range with non-zero pixels could produce
    // Infinity. Semantically that's "infinite resolution per hour" — we
    // want depth 0 because we're zoomed in, not because the input was bad.
    expect(collapseDepthForPixelsPerHour(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('threshold continuity: 5 → 1, just below 5 → Infinity (no gap)', () => {
    expect(collapseDepthForPixelsPerHour(5)).toBe(1)
    expect(collapseDepthForPixelsPerHour(4.99)).toBe(Number.POSITIVE_INFINITY)
  })

  it('threshold continuity: 30 → 1, just above 30 → 0', () => {
    expect(collapseDepthForPixelsPerHour(30)).toBe(1)
    expect(collapseDepthForPixelsPerHour(30.01)).toBe(0)
  })
})

describe('computePixelsPerHour', () => {
  const d = (h: number) => new Date(`2026-01-01T${String(h).padStart(2, '0')}:00:00Z`)

  it('returns chart pixels divided by visible hours', () => {
    expect(computePixelsPerHour(1000, d(0), d(24))).toBeCloseTo(1000 / 24, 4)
    expect(computePixelsPerHour(720, d(0), d(24))).toBeCloseTo(30, 4)
  })

  it('returns 0 when chart pixels are not yet measured', () => {
    expect(computePixelsPerHour(0, d(0), d(24))).toBe(0)
    expect(computePixelsPerHour(-10, d(0), d(24))).toBe(0)
    expect(computePixelsPerHour(NaN, d(0), d(24))).toBe(0)
    expect(computePixelsPerHour(Number.POSITIVE_INFINITY, d(0), d(24))).toBe(0)
  })

  it('returns 0 when the visible range is degenerate', () => {
    expect(computePixelsPerHour(1000, d(0), d(0))).toBe(0)
    expect(computePixelsPerHour(1000, d(5), d(3))).toBe(0)
  })
})
