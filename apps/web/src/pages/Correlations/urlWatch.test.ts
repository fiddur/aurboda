import { describe, expect, test } from 'vitest'

import { DEFAULT_ANALYZE_STATE, withAnalyzeState } from './urlState'
import { createUrlWatch } from './urlWatch'

const ORIGIN = 'https://aurboda.example'
const PAGE = `${ORIGIN}/correlations`

describe('createUrlWatch', () => {
  test('a state change the page has not written yet is not a navigation', () => {
    const watch = createUrlWatch(PAGE)

    expect(watch.changedElsewhere(PAGE)).toBe(false)
  })

  test("the page's own write is not a navigation", () => {
    const watch = createUrlWatch(PAGE)
    const written = `${ORIGIN}${withAnalyzeState(PAGE, { ...DEFAULT_ANALYZE_STATE, breakdown: 'duration' })}`
    watch.saw(written)

    expect(watch.changedElsewhere(written)).toBe(false)
  })

  test('a link back to the plain page after a write is a navigation, once', () => {
    const watch = createUrlWatch(PAGE)
    watch.saw(`${PAGE}?breakdown=duration`)

    expect(watch.changedElsewhere(PAGE)).toBe(true)
    watch.saw(PAGE)
    expect(watch.changedElsewhere(PAGE)).toBe(false)
  })
})
