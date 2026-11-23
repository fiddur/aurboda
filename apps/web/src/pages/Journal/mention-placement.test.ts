import { describe, expect, test } from 'vitest'

import { mentionMenuPlacement } from './mention-placement'

const base = { cap: 256, visibleBottom: 800, visibleTop: 0, wrapBottom: 700, wrapTop: 100 }

describe('where the @ menu goes', () => {
  test('under the caret line when it fits, its top just below the line', () => {
    expect(mentionMenuPlacement({ ...base, caretBottom: 220, caretTop: 200 })).toEqual({
      maxHeight: 256,
      offset: 124,
      side: 'below',
    })
  })

  test('below even when it is short of the cap, as long as a useful height fits', () => {
    expect(mentionMenuPlacement({ ...base, caretBottom: 600, caretTop: 580 })).toEqual({
      maxHeight: 196,
      offset: 504,
      side: 'below',
    })
  })

  test('above the caret line when too little fits below and more fits above, its bottom just above the line', () => {
    expect(mentionMenuPlacement({ ...base, caretBottom: 740, caretTop: 720, wrapBottom: 790 })).toEqual({
      maxHeight: 256,
      offset: 74,
      side: 'above',
    })
  })

  test('in a viewport the keyboard shrank, above the line the menu stays in the visible part', () => {
    expect(
      mentionMenuPlacement({
        ...base,
        cap: 120,
        caretBottom: 330,
        caretTop: 310,
        visibleBottom: 400,
        visibleTop: 100,
      }),
    ).toEqual({ maxHeight: 120, offset: 394, side: 'above' })
  })

  test('when neither side fits a useful height, the bigger side', () => {
    const small = { ...base, cap: 256, visibleBottom: 200, visibleTop: 0 }
    expect(mentionMenuPlacement({ ...small, caretBottom: 120, caretTop: 100 }).side).toBe('above')
    expect(mentionMenuPlacement({ ...small, caretBottom: 80, caretTop: 60 }).side).toBe('below')
  })

  test('never taller than the cap, and never squeezed under 80 pixels (or the cap, if smaller)', () => {
    expect(mentionMenuPlacement({ ...base, cap: 100, caretBottom: 220, caretTop: 200 }).maxHeight).toBe(100)
    expect(
      mentionMenuPlacement({ ...base, caretBottom: 60, caretTop: 40, visibleBottom: 100 }).maxHeight,
    ).toBe(80)
    expect(
      mentionMenuPlacement({ ...base, cap: 50, caretBottom: 60, caretTop: 40, visibleBottom: 100 }).maxHeight,
    ).toBe(50)
  })
})
