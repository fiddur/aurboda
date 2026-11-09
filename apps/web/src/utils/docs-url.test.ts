import { describe, expect, test } from 'vitest'

import { docsUrl } from './docs-url'

describe('docsUrl', () => {
  test('points at the doc on the released branch', () => {
    expect(docsUrl('features/timeline.md')).toBe(
      'https://github.com/fiddur/aurboda/blob/main/docs/features/timeline.md',
    )
  })

  test('keeps a fragment and ignores a leading slash', () => {
    expect(docsUrl('/data-export.md#restore')).toBe(
      'https://github.com/fiddur/aurboda/blob/main/docs/data-export.md#restore',
    )
  })
})
