import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { barWindowCeil, barWindowStart, nextBarWindowStart } from './barWindows'

// Vitest pins TZ=UTC (vite.config.ts), so local boundaries equal UTC ones here.
describe('barWindowStart', () => {
  it('aligns weeks to Monday, not to the epoch Thursday', () => {
    // 2026-01-01 is a Thursday; the old epoch grid started a week on it.
    expect(barWindowStart(new Date('2026-01-01T15:00:00Z'), '1w')).toEqual(new Date('2025-12-29T00:00:00Z'))
    expect(barWindowStart(new Date('2026-01-04T23:59:00Z'), '1w')).toEqual(new Date('2025-12-29T00:00:00Z'))
    expect(barWindowStart(new Date('2026-01-05T00:00:00Z'), '1w')).toEqual(new Date('2026-01-05T00:00:00Z'))
  })

  it('aligns days to local midnight and hours to the hour', () => {
    expect(barWindowStart(new Date('2026-03-10T17:42:00Z'), '1d')).toEqual(new Date('2026-03-10T00:00:00Z'))
    expect(barWindowStart(new Date('2026-03-10T17:42:00Z'), '1h')).toEqual(new Date('2026-03-10T17:00:00Z'))
  })
})

describe('nextBarWindowStart / barWindowCeil', () => {
  it('steps one window forward', () => {
    expect(nextBarWindowStart(new Date('2025-12-29T00:00:00Z'), '1w')).toEqual(
      new Date('2026-01-05T00:00:00Z'),
    )
    expect(nextBarWindowStart(new Date('2026-03-10T00:00:00Z'), '1d')).toEqual(
      new Date('2026-03-11T00:00:00Z'),
    )
  })

  it('leaves a boundary in place and rounds anything else up', () => {
    expect(barWindowCeil(new Date('2026-03-10T00:00:00Z'), '1d')).toEqual(new Date('2026-03-10T00:00:00Z'))
    expect(barWindowCeil(new Date('2026-03-10T00:00:01Z'), '1d')).toEqual(new Date('2026-03-11T00:00:00Z'))
  })

  // DST needs a non-UTC zone. Mutating the worker-shared process.env.TZ is off limits
  // (#1014), so the module runs in a child Node process (native TS type stripping)
  // with its own TZ.
  it('makes DST days 23 and 25 hours long in local time', { timeout: 20_000 }, () => {
    const moduleUrl = new URL('./barWindows.ts', import.meta.url).href
    const script = `
      const { barWindowStart, nextBarWindowStart } = await import(${JSON.stringify(moduleUrl)})
      const hours = (iso) => {
        const start = barWindowStart(new Date(iso), '1d')
        return [start.toISOString(), (nextBarWindowStart(start, '1d') - start) / 3600000]
      }
      console.log(JSON.stringify([hours('2026-03-29T12:00:00+02:00'), hours('2026-10-25T12:00:00+01:00')]))
    `
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      env: { PATH: process.env.PATH, TZ: 'Europe/Stockholm' },
    })
    expect(JSON.parse(out.toString())).toEqual([
      ['2026-03-28T23:00:00.000Z', 23],
      ['2026-10-24T22:00:00.000Z', 25],
    ])
  })
})
