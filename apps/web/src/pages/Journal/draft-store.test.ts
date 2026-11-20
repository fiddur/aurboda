import { describe, expect, test } from 'vitest'

import type { DraftStorage } from './draft-store'

import {
  draftStorageFor,
  clearDraftIfConfirmed,
  draftToOffer,
  loadDraft,
  moveDraft,
  NEW_ENTRY_KEY,
  removeDraft,
  saveDraft,
} from './draft-store'
import { emptyEntryForm } from './entry-form'

const memory = (): DraftStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    map,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  }
}

const form = { ...emptyEntryForm(new Date(2026, 10, 20, 9, 0)), content: 'Walked to the lake' }

describe('the draft store', () => {
  test('saves and loads a draft by entry', () => {
    const storage = memory()
    saveDraft(storage, { edited_at: 5, form, key: 'abc' })
    expect(loadDraft(storage, 'abc')).toEqual({ edited_at: 5, form, key: 'abc' })
    expect(loadDraft(storage, 'other')).toBeUndefined()
  })

  test('ignores what it cannot read, and survives a storage that throws', () => {
    const storage = memory()
    storage.setItem('aurboda.journal.draft.abc', '{not json')
    expect(loadDraft(storage, 'abc')).toBeUndefined()
    const broken: DraftStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
    }
    expect(() => saveDraft(broken, { edited_at: 1, form, key: 'x' })).not.toThrow()
    expect(loadDraft(broken, 'x')).toBeUndefined()
    expect(() => removeDraft(broken, 'x')).not.toThrow()
    expect(loadDraft(undefined, 'x')).toBeUndefined()
  })

  test('is cleared only when the server confirmed exactly that content', () => {
    const storage = memory()
    saveDraft(storage, {
      edited_at: 5,
      form: { ...form, content: 'Walked to the lake and back' },
      key: 'abc',
    })
    clearDraftIfConfirmed(storage, 'abc', form)
    expect(loadDraft(storage, 'abc')).toBeDefined()
    clearDraftIfConfirmed(storage, 'abc', { ...form, content: 'Walked to the lake and back' })
    expect(loadDraft(storage, 'abc')).toBeUndefined()
  })

  test('follows a new entry to its id', () => {
    const storage = memory()
    saveDraft(storage, { edited_at: 5, form, key: NEW_ENTRY_KEY })
    moveDraft(storage, NEW_ENTRY_KEY, 'abc')
    expect(loadDraft(storage, NEW_ENTRY_KEY)).toBeUndefined()
    expect(loadDraft(storage, 'abc')?.form).toEqual(form)
  })
})

describe('draftToOffer', () => {
  const draft = { edited_at: new Date('2026-11-20T10:00:00Z').getTime(), form, key: 'abc' }

  test('offers a newer draft that says something else', () => {
    expect(
      draftToOffer(draft, { form: { ...form, content: 'Old' }, updated_at: '2026-11-20T09:00:00Z' }),
    ).toBe(draft)
  })

  test('not one the server already has, nor one older than the server version', () => {
    expect(draftToOffer(draft, { form, updated_at: '2026-11-20T09:00:00Z' })).toBeUndefined()
    expect(
      draftToOffer(draft, { form: { ...form, content: 'Newer' }, updated_at: '2026-11-20T11:00:00Z' }),
    ).toBeUndefined()
  })

  test('a new entry offers any draft with words in it', () => {
    expect(draftToOffer(draft, undefined)).toBe(draft)
    expect(draftToOffer({ ...draft, form: { ...form, content: '  ' } }, undefined)).toBeUndefined()
    expect(draftToOffer(undefined, undefined)).toBeUndefined()
  })
})

describe('draftStorageFor', () => {
  test('one account never sees the draft another left in the same browser', () => {
    const storage = memory()
    const alice = draftStorageFor(storage, 'alice')
    saveDraft(alice, { edited_at: 1, form, key: NEW_ENTRY_KEY })
    expect(loadDraft(alice, NEW_ENTRY_KEY)?.form.content).toBe('Walked to the lake')
    expect(loadDraft(draftStorageFor(storage, 'bob'), NEW_ENTRY_KEY)).toBeUndefined()
    expect(loadDraft(storage, NEW_ENTRY_KEY)).toBeUndefined()
  })

  test('keeps no drafts without an account', () => {
    expect(draftStorageFor(memory(), undefined)).toBeUndefined()
  })
})
