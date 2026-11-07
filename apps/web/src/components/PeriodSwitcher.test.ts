import { periodLabel } from '@aurboda/api-spec'
import { describe, expect, it } from 'vitest'

import { periodSteps } from './PeriodSwitcher'

describe('periodSteps', () => {
  it('stops at the latest finished period', () => {
    expect(periodSteps('2026-10', '2026-10')).toEqual({ next: null, previous: '2026-09' })
  })

  it('steps across year boundaries', () => {
    expect(periodSteps('2025-12', '2026-10')).toEqual({ next: '2026-01', previous: '2025-11' })
    expect(periodSteps('2026-W01', '2026-W44')).toEqual({ next: '2026-W02', previous: '2025-W52' })
    expect(periodSteps('2024', '2025')).toEqual({ next: '2025', previous: '2023' })
  })

  it('labels the periods it steps between', () => {
    expect(periodLabel('2026-10')).toBe('October 2026')
    expect(periodLabel('2026-W44')).toBe('Week 44, 2026')
    expect(periodLabel('2025')).toBe('2025')
  })
})
