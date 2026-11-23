import { describe, expect, test } from 'vitest'

import { initialEntryMode } from './entry-mode'

describe('initialEntryMode', () => {
  test('a new entry opens for writing', () => {
    expect(initialEntryMode({ content: '', isNew: true })).toBe('edit')
    expect(initialEntryMode({ content: 'from a template', isNew: true })).toBe('edit')
  })

  test('an existing entry with text opens for reading', () => {
    expect(initialEntryMode({ content: 'Went for a walk.', isNew: false })).toBe('read')
  })

  test('an existing entry without text opens for writing', () => {
    expect(initialEntryMode({ content: '', isNew: false })).toBe('edit')
    expect(initialEntryMode({ content: '  \n\t', isNew: false })).toBe('edit')
  })
})
