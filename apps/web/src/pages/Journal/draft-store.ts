import type { EntryForm } from './entry-form'

import { sameEntry } from './entry-form'

/** The part of `Storage` the drafts use, so tests can hand in a plain map. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const NEW_ENTRY_KEY = 'new'

/** A local copy of what is in the editor, kept until the server has confirmed exactly this. */
export interface EntryDraft {
  /** The entry's id, or `new` before its first save gave it one. */
  key: string
  form: EntryForm
  /** When it was last changed, ms since the epoch. */
  edited_at: number
}

const storageKey = (key: string) => `aurboda.journal.draft.${key}`

const isForm = (value: unknown): value is EntryForm => {
  if (typeof value !== 'object' || value === null) return false
  const form = value as Record<string, unknown>
  return (
    typeof form.title === 'string' &&
    typeof form.content === 'string' &&
    Array.isArray(form.tags) &&
    typeof form.allDay === 'boolean' &&
    typeof form.date === 'string' &&
    typeof form.start === 'string' &&
    typeof form.end === 'string'
  )
}

/** Storage can be full, blocked or absent (a private window): losing the local copy must never break the editor. */
const attempt = <T>(run: () => T, fallback: T): T => {
  try {
    return run()
  } catch {
    return fallback
  }
}

export const loadDraft = (storage: DraftStorage | undefined, key: string): EntryDraft | undefined =>
  attempt(() => {
    const raw = storage?.getItem(storageKey(key))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<EntryDraft>
    if (parsed.key !== key || typeof parsed.edited_at !== 'number' || !isForm(parsed.form)) return undefined
    return { edited_at: parsed.edited_at, form: parsed.form, key }
  }, undefined)

export const saveDraft = (storage: DraftStorage | undefined, draft: EntryDraft): void =>
  attempt(() => storage?.setItem(storageKey(draft.key), JSON.stringify(draft)), undefined)

export const removeDraft = (storage: DraftStorage | undefined, key: string): void =>
  attempt(() => storage?.removeItem(storageKey(key)), undefined)

/** Clear the draft only when it holds exactly what the server confirmed; newer typing stays. */
export const clearDraftIfConfirmed = (
  storage: DraftStorage | undefined,
  key: string,
  confirmed: EntryForm,
): void => {
  const draft = loadDraft(storage, key)
  if (draft && sameEntry(draft.form, confirmed)) removeDraft(storage, key)
}

/** The first save gave the entry an id: its draft follows it there. */
export const moveDraft = (storage: DraftStorage | undefined, from: string, to: string): void => {
  const draft = loadDraft(storage, from)
  if (!draft) return
  saveDraft(storage, { ...draft, key: to })
  removeDraft(storage, from)
}

/**
 * A draft worth offering when opening an entry: it says something the server's version does not,
 * and it was written after the server's version was saved (or there is no server version yet).
 */
export const draftToOffer = (
  draft: EntryDraft | undefined,
  server: { form: EntryForm; updated_at?: string } | undefined,
): EntryDraft | undefined => {
  if (!draft) return undefined
  if (!server) return draft.form.content.trim() || draft.form.title.trim() ? draft : undefined
  if (sameEntry(draft.form, server.form)) return undefined
  const savedAt = server.updated_at ? new Date(server.updated_at).getTime() : 0
  return draft.edited_at > savedAt ? draft : undefined
}

export const browserStorage = (): DraftStorage | undefined => attempt(() => window.localStorage, undefined)

/**
 * Drafts are kept per account: an unsaved one outlives a sign-out (an expired session must not lose
 * the text), so in a shared browser it must never be offered to whoever signs in next.
 */
export const draftStorageFor = (
  storage: DraftStorage | undefined,
  user: string | undefined,
): DraftStorage | undefined => {
  if (!storage || !user) return undefined
  const scoped = (key: string) => `${key}.${encodeURIComponent(user)}`
  return {
    getItem: (key) => storage.getItem(scoped(key)),
    removeItem: (key) => storage.removeItem(scoped(key)),
    setItem: (key, value) => storage.setItem(scoped(key), value),
  }
}
