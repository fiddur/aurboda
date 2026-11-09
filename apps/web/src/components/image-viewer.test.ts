import { describe, expect, test } from 'vitest'

import { opensImageViewer } from './image-viewer'

const click = (overrides: Partial<Parameters<typeof opensImageViewer>[0]> = {}) => ({
  altKey: false,
  button: 0,
  ctrlKey: false,
  defaultPrevented: false,
  metaKey: false,
  shiftKey: false,
  ...overrides,
})

describe('opensImageViewer', () => {
  test('opens on a plain left click', () => {
    expect(opensImageViewer(click())).toBe(true)
  })

  test('keeps the link behaviour for a middle or right click', () => {
    expect(opensImageViewer(click({ button: 1 }))).toBe(false)
    expect(opensImageViewer(click({ button: 2 }))).toBe(false)
  })

  test('keeps the link behaviour when a modifier key is held', () => {
    for (const key of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
      expect(opensImageViewer(click({ [key]: true }))).toBe(false)
    }
  })

  test('does nothing when another handler already took the click', () => {
    expect(opensImageViewer(click({ defaultPrevented: true }))).toBe(false)
  })
})
