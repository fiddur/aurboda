import type { EntryForm } from './entry-form'

import { unionLinks } from './related'

export type ConflictChoice = 'mine' | 'theirs' | 'both'

export const KEEP_BOTH_DIVIDER = '\n\n---\n\n'

/** Theirs first, then mine below a divider; the same text twice is kept once. */
export const keepBothText = (theirs: string, mine: string): string => {
  if (theirs.trim() === mine.trim()) return theirs
  if (theirs.trim() === '') return mine
  if (mine.trim() === '') return theirs
  return `${theirs.trimEnd()}${KEEP_BOTH_DIVIDER}${mine.trimStart()}`
}

/**
 * The form to save after a 409. Every choice is saved on top of their version (its `updated_at`),
 * so it is the newest; text, title and tags follow the choice, and the links of both versions are
 * kept whichever it is.
 */
export const resolveConflict = (choice: ConflictChoice, mine: EntryForm, theirs: EntryForm): EntryForm => {
  const related = unionLinks(theirs.related, mine.related)
  if (choice === 'theirs') return { ...theirs, related }
  if (choice === 'mine') return { ...mine, related }
  return {
    ...theirs,
    content: keepBothText(theirs.content, mine.content),
    related,
    tags: [...new Set([...theirs.tags, ...mine.tags])],
    title: theirs.title.trim() || mine.title,
  }
}
