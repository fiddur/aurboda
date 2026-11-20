import { describe, expect, test } from 'vitest'

import { keepBothText, resolveConflict } from './conflict'
import { emptyEntryForm } from './entry-form'

describe('keepBothText', () => {
  test('theirs, then mine below a divider', () => {
    expect(keepBothText('Their words\n', '\nMy words')).toBe('Their words\n\n---\n\nMy words')
  })

  test('the same text, or one side empty, is kept once', () => {
    expect(keepBothText('Same', 'Same ')).toBe('Same')
    expect(keepBothText('', 'Mine')).toBe('Mine')
    expect(keepBothText('Theirs', '  ')).toBe('Theirs')
  })
})

describe('resolveConflict', () => {
  const base = emptyEntryForm(new Date(2026, 10, 20))
  const mine = { ...base, content: 'Mine', tags: ['a'], title: '' }
  const theirs = { ...base, content: 'Theirs', tags: ['b'], title: 'Their title' }

  test('keep mine or theirs as they are', () => {
    expect(resolveConflict('mine', mine, theirs)).toBe(mine)
    expect(resolveConflict('theirs', mine, theirs)).toBe(theirs)
  })

  test('keep both joins texts and tags, keeping their title', () => {
    expect(resolveConflict('both', mine, theirs)).toMatchObject({
      content: 'Theirs\n\n---\n\nMine',
      tags: ['b', 'a'],
      title: 'Their title',
    })
  })
})
