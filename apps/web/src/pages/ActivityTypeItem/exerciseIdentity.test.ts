import { describe, expect, test } from 'vitest'

import { identityView, MERGE_HINT, otherValuesHint } from './exerciseIdentity'

describe('identityView', () => {
  test('a catalogue match shows the entry and can be changed or dismissed', () => {
    const view = identityView('catalog')
    expect(view.line).toBe('Matched to the catalogue by name')
    expect(view.showsEntry).toBe(true)
    expect(view.pickerInitiallyOpen).toBe(false)
    expect(view.actions).toEqual([
      { kind: 'pick', label: 'Change' },
      { kind: 'dismiss', label: 'Not this exercise' },
    ])
  })

  test("the user's mapping shows the entry and can be changed or removed", () => {
    const view = identityView('user')
    expect(view.line).toBe('Mapped by you')
    expect(view.showsEntry).toBe(true)
    expect(view.actions).toEqual([
      { kind: 'pick', label: 'Change' },
      { kind: 'clear', label: 'Remove mapping' },
    ])
  })

  test('an unmapped name opens the picker and can be dismissed', () => {
    const view = identityView('unmapped')
    expect(view.line).toBe('Not matched to the built-in catalogue')
    expect(view.showsEntry).toBe(false)
    expect(view.pickerInitiallyOpen).toBe(true)
    expect(view.actions).toEqual([
      { kind: 'pick', label: 'Find in the catalogue' },
      { kind: 'dismiss', label: 'Not in the catalogue' },
    ])
  })

  test('a dismissed name can only be undone', () => {
    const view = identityView('dismissed')
    expect(view.line).toBe('Marked as not in the catalogue')
    expect(view.showsEntry).toBe(false)
    expect(view.actions).toEqual([{ kind: 'clear', label: 'Undo' }])
  })
})

describe('otherValuesHint', () => {
  test('points at the merge control when the page shows it', () => {
    expect(otherValuesHint(2, true)).toBe(MERGE_HINT)
  })

  test('is absent without the merge control or other values', () => {
    expect(otherValuesHint(2, false)).toBeUndefined()
    expect(otherValuesHint(0, true)).toBeUndefined()
  })
})
