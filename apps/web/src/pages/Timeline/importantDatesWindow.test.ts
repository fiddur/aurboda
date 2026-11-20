import { expect, test } from 'vitest'

import { importantDatesWindow } from './importantDatesWindow'

test('the window is the local dates of the fetch range, at most 400 days long', () => {
  expect(importantDatesWindow(new Date(2026, 10, 1, 13), new Date(2026, 11, 2, 1))).toEqual({
    from: '2026-11-01',
    to: '2026-12-02',
  })
  expect(importantDatesWindow(new Date(2024, 0, 1), new Date(2026, 0, 1))).toEqual({
    from: '2024-01-01',
    to: '2025-02-04',
  })
})
