import { describe, expect, it } from 'vitest'

import type { SessionDraft } from './sessionModel'

import {
  clearLiveDraft,
  type DraftStorage,
  LIVE_DRAFT_KEY,
  LOG_DRAFT_KEY,
  readLiveDraft,
  readLogDraft,
  readNumberPref,
  writeLiveDraft,
  writeLogDraft,
  writeNumberPref,
} from './draftStorage'

const memory = (initial: Record<string, string> = {}): DraftStorage & { data: Record<string, string> } => {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => data[k] ?? null,
    removeItem: (k) => {
      delete data[k]
    },
    setItem: (k, v) => {
      data[k] = v
    },
  }
}

const throwing: DraftStorage = {
  getItem: () => {
    throw new Error('blocked')
  },
  removeItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
}

const live: SessionDraft = {
  blocks: [
    { exercise: 'Squat', id: 'b1', planned: [], sets: [{ exercise: 'Squat', reps: 5, superset_id: 'x' }] },
  ],
  id: 'act1',
  last_set_at: '2026-11-10T17:30:00.000Z',
  rev: 3,
  saved_rev: 2,
  start_time: '2026-11-10T17:02:00.000Z',
}

describe('live draft', () => {
  it('round-trips', () => {
    const storage = memory()
    writeLiveDraft(live, storage)
    expect(readLiveDraft(storage)).toEqual(live)
    clearLiveDraft(storage)
    expect(readLiveDraft(storage)).toBeUndefined()
  })

  it('drops a malformed, older or wrongly shaped draft', () => {
    for (const raw of [
      'not json',
      JSON.stringify({ draft: live, version: 0 }),
      JSON.stringify({ draft: { ...live, blocks: [{ exercise: 1 }] }, version: 1 }),
      JSON.stringify({ draft: { ...live, start_time: 'soon' }, version: 1 }),
    ]) {
      const storage = memory({ [LIVE_DRAFT_KEY]: raw })
      expect(readLiveDraft(storage)).toBeUndefined()
      expect(storage.data[LIVE_DRAFT_KEY]).toBeUndefined()
    }
  })

  it('never throws when storage is blocked', () => {
    expect(readLiveDraft(throwing)).toBeUndefined()
    expect(() => writeLiveDraft(live, throwing)).not.toThrow()
    expect(() => clearLiveDraft(throwing)).not.toThrow()
    expect(readLiveDraft(undefined)).toBeUndefined()
  })
})

describe('log draft', () => {
  it('round-trips and drops a bad one', () => {
    const storage = memory()
    const draft = { blocks: [], date: '2026-11-10', minutes: '60', time: '17:00' }
    writeLogDraft(draft, storage)
    expect(readLogDraft(storage)).toEqual(draft)
    storage.setItem(LOG_DRAFT_KEY, JSON.stringify({ draft: { ...draft, minutes: 60 }, version: 1 }))
    expect(readLogDraft(storage)).toBeUndefined()
  })
})

describe('number preferences', () => {
  it('reads an allowed stored value, else the fallback', () => {
    const storage = memory()
    expect(readNumberPref('k', 2.5, [0.5, 2.5, 5], storage)).toBe(2.5)
    writeNumberPref('k', 5, storage)
    expect(readNumberPref('k', 2.5, [0.5, 2.5, 5], storage)).toBe(5)
    writeNumberPref('k', 7, storage)
    expect(readNumberPref('k', 2.5, [0.5, 2.5, 5], storage)).toBe(2.5)
    expect(readNumberPref('k', 2.5, [0.5], throwing)).toBe(2.5)
  })
})
