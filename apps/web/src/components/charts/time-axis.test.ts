import { describe, expect, test } from 'vitest'

import { timeAxisLayout, type TimeAxisLayout } from './time-axis'

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)
const DAY_MS = 86_400_000

const gapsInDays = (layout: TimeAxisLayout) =>
  layout.ticks
    .slice(1)
    .map((t, i) => Math.round((t.date.getTime() - layout.ticks[i].date.getTime()) / DAY_MS))

const labelWidth = (layout: TimeAxisLayout) => Math.max(...layout.ticks.map((t) => t.label.length)) * 6.5 + 12

const fitsWidth = (layout: TimeAxisLayout, width: number) =>
  layout.ticks.length * Math.min(44, labelWidth(layout)) <= width

const yearTick = (layout: TimeAxisLayout, year: number) =>
  layout.ticks.find((t) => t.date.getTime() === day(year, 1, 1).getTime())

describe('timeAxisLayout', () => {
  test('a 3-day span shows one tick per day', () => {
    const layout = timeAxisLayout([day(2026, 3, 10), new Date(day(2026, 3, 13).getTime() - 1)], 1100)
    expect(layout.ticks.map((t) => t.label)).toEqual(['10 Mar', '11 Mar', '12 Mar'])
    expect(layout.rotate).toBe(false)
    expect(layout.bottomMargin).toBe(30)
  })

  test('day steps never exceed ~6 ticks (the old daySpanTickStep cap)', () => {
    for (const span of [6, 7, 12, 30, 31]) {
      const layout = timeAxisLayout([day(2026, 3, 1), day(2026, 3, 1 + span)], 1100)
      expect(layout.ticks.length).toBeLessThanOrEqual(7)
      const step = Math.max(1, Math.ceil(span / 6))
      expect(new Set(gapsInDays(layout))).toEqual(new Set([step]))
    }
  })

  test('31 days at 1100px ticks every 5–6 days, at most 6 ticks, evenly across a month boundary', () => {
    const layout = timeAxisLayout([day(2026, 3, 20), day(2026, 4, 20)], 1100)
    expect(layout.ticks.length).toBeLessThanOrEqual(6)
    for (const gap of gapsInDays(layout)) expect([5, 6]).toContain(gap)
    expect(layout.ticks[0].label).toBe('20 Mar')
  })

  test('90 days at 1100px ticks weekly with "d MMM", horizontal', () => {
    const layout = timeAxisLayout([day(2026, 3, 1), day(2026, 5, 30)], 1100)
    expect(new Set(gapsInDays(layout))).toEqual(new Set([7]))
    for (const t of layout.ticks) expect(t.label).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/)
    expect(layout.rotate).toBe(false)
    expect(layout.yearBreaks).toEqual([])
  })

  test('90 days at 320px thins to two-weekly or monthly, rotating only when labels would collide', () => {
    const layout = timeAxisLayout([day(2026, 3, 1), day(2026, 5, 30)], 320)
    expect(fitsWidth(layout, 320)).toBe(true)
    expect(Math.min(...gapsInDays(layout))).toBeGreaterThanOrEqual(14)
    expect(layout.rotate).toBe(layout.ticks.length * labelWidth(layout) > 320)
    expect(layout.bottomMargin).toBe(layout.rotate ? 50 : 30)
  })

  test('19 months at 1100px ticks monthly, labels 1 January with the year and breaks there', () => {
    const layout = timeAxisLayout([day(2025, 4, 1), day(2026, 10, 28)], 1100)
    expect(layout.ticks.map((t) => t.label)).toEqual([
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
      '2026',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
    ])
    expect(yearTick(layout, 2026)?.year).toBe(true)
    expect(layout.ticks.filter((t) => t.year)).toHaveLength(1)
    expect(layout.yearBreaks.map((t) => t.date)).toEqual([day(2026, 1, 1)])
    expect(layout.yearBreaks[0].label).toBe('2026')
    expect(layout.rotate).toBe(false)
  })

  test('19 months at 320px ticks quarterly with 2026 at the January tick, for the bar and the line domain', () => {
    const bar = timeAxisLayout([day(2025, 4, 1), day(2026, 10, 28)], 320)
    expect(bar.ticks.map((t) => t.label)).toEqual(['Apr', 'Jul', 'Oct', '2026', 'Apr', 'Jul', 'Oct'])
    expect(yearTick(bar, 2026)?.year).toBe(true)
    const line = timeAxisLayout([day(2025, 4, 6), day(2026, 10, 25)], 320)
    expect(line.ticks.map((t) => t.label)).toEqual(['Jul', 'Oct', '2026', 'Apr', 'Jul', 'Oct'])
  })

  test('short labels fit by their horizontal width: 7 quarterly ticks fit 288px unrotated', () => {
    const layout = timeAxisLayout([day(2025, 4, 1), day(2026, 10, 28)], 288)
    expect(layout.ticks.map((t) => t.label)).toEqual(['Apr', 'Jul', 'Oct', '2026', 'Apr', 'Jul', 'Oct'])
    expect(layout.rotate).toBe(false)
    expect(layout.bottomMargin).toBe(30)
  })

  test('5 years at 1100px labels every 1 January with its year', () => {
    const layout = timeAxisLayout([day(2021, 11, 1), day(2026, 10, 28)], 1100)
    expect(fitsWidth(layout, 1100)).toBe(true)
    for (const year of [2022, 2023, 2024, 2025, 2026]) {
      expect(yearTick(layout, year)).toMatchObject({ label: String(year), year: true })
    }
    expect(layout.yearBreaks.map((t) => t.label)).toEqual(['2022', '2023', '2024', '2025', '2026'])
  })

  test('a year break that falls between ticks is added as a labelled tick', () => {
    const layout = timeAxisLayout([day(2025, 10, 15), day(2026, 3, 15)], 1100)
    const gaps = gapsInDays(layout)
    expect(gaps.filter((g) => g === 7).length).toBeGreaterThanOrEqual(gaps.length - 2)
    expect(yearTick(layout, 2026)).toMatchObject({ label: '2026', year: true })
    const jan1 = day(2026, 1, 1).getTime()
    for (const t of layout.ticks) {
      if (!t.year) expect(Math.abs(t.date.getTime() - jan1)).toBeGreaterThanOrEqual(3.5 * DAY_MS)
    }
  })

  test('a two-month step over two years starting in February still labels 1 January 2026', () => {
    const domain: [Date, Date] = [day(2025, 2, 1), day(2027, 1, 31)]
    const layout = timeAxisLayout(domain, 600)
    expect(gapsInDays(layout).every((g) => g >= 59 && g <= 62)).toBe(true)
    expect(yearTick(layout, 2026)).toMatchObject({ label: '2026', year: true })
    expect(yearTick(layout, 2027)).toMatchObject({ label: '2027', year: true })
  })

  test('a span under 120 days has no year breaks, even across New Year', () => {
    const layout = timeAxisLayout([day(2025, 11, 15), day(2026, 2, 15)], 1100)
    expect(layout.yearBreaks).toEqual([])
  })

  test('sub-day spans tick by the hour, labelling midnight with the date', () => {
    const layout = timeAxisLayout([day(2026, 3, 10), day(2026, 3, 11)], 1100)
    expect(layout.ticks[0].label).toBe('10 Mar')
    expect(layout.ticks[1].label).toMatch(/^\d{2}:00$/)
    expect(fitsWidth(layout, 1100)).toBe(true)
  })

  test('bottomMargin follows rotate', () => {
    const narrow = timeAxisLayout([day(2026, 3, 1), day(2026, 5, 30)], 200)
    const wide = timeAxisLayout([day(2026, 3, 1), day(2026, 5, 30)], 1100)
    for (const layout of [narrow, wide]) expect(layout.bottomMargin).toBe(layout.rotate ? 50 : 30)
  })
})
