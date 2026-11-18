import { describe, expect, it } from 'vitest'

import { catalogSearch, showsClosestCaption } from './exerciseCatalogPickerModel'

describe('catalogSearch', () => {
  it('searches by text from two characters, with the similar name when there is one', () => {
    expect(catalogSearch('be', 'Bench')).toEqual({ q: 'be', similar_to: 'Bench' })
    expect(catalogSearch('be', undefined)).toEqual({ q: 'be' })
    expect(catalogSearch('b', 'Bench')).toEqual({ similar_to: 'Bench' })
    expect(catalogSearch('b', undefined)).toBeUndefined()
  })
})

describe('showsClosestCaption', () => {
  it('captions the entries closest to the name while no search has run', () => {
    expect(showsClosestCaption('', 'Bench', 3)).toBe(true)
    expect(showsClosestCaption('b', 'Bench', 3)).toBe(true)
  })

  it('follows the query that produced the entries, not the typed text', () => {
    expect(showsClosestCaption('bench', 'Bench', 3)).toBe(false)
  })

  it('shows nothing without a similar name or without entries', () => {
    expect(showsClosestCaption('', undefined, 3)).toBe(false)
    expect(showsClosestCaption('', 'Bench', 0)).toBe(false)
  })
})
