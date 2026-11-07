/**
 * Hashtags on feed posts, shared by the backend (which stores and federates
 * them) and the web (which edits them). A tag is stored lowercase without its
 * `#`: letters, digits and `_`, at least one of them not a digit, at most
 * {@link hashtagMaxLength} characters. Mastodon convention: separate tags
 * (`#aurboda #running`), never compounds.
 */

export const hashtagMaxLength = 64
export const maxPostTags = 10
export const defaultFeedTags: readonly string[] = ['aurboda']

const TAG_BODY = /^[\p{L}\p{N}_]+$/u
const NON_DIGIT = /[^\p{N}]/u

export const isValidHashtag = (tag: string): boolean =>
  tag.length > 0 && tag.length <= hashtagMaxLength && TAG_BODY.test(tag) && NON_DIGIT.test(tag)

const stripHash = (value: string): string => (value.startsWith('#') ? value.slice(1) : value)

/** One tag as stored: trimmed, without a leading `#`, NFC, lowercase; null when it is not a valid tag. */
export const normalizeTag = (value: string): string | null => {
  const tag = stripHash(value.trim()).normalize('NFC').toLowerCase()
  return isValidHashtag(tag) ? tag : null
}

/** Lowercase, strip `#`, drop invalid ones, dedupe keeping first-seen order, cap at {@link maxPostTags}. */
export const normalizeTags = (list: readonly string[]): string[] => {
  const out: string[] = []
  for (const value of list) {
    const tag = normalizeTag(value)
    if (tag == null || out.includes(tag)) continue
    out.push(tag)
    if (out.length === maxPostTags) break
  }
  return out
}

/** A tag from a display name or key: only its letters and digits, lowercase (`Dumbbell Bench Press` → `dumbbellbenchpress`). */
export const toTag = (name: string): string | null => {
  const tag = name
    .normalize('NFC')
    .replaceAll(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase()
    .slice(0, hashtagMaxLength)
  return isValidHashtag(tag) ? tag : null
}

export interface HashtagMatch {
  /** Index of the `#` in the searched text. */
  index: number
  /** The tag as written, without `#` (original casing). */
  text: string
  /** The stored form. */
  tag: string
}

// Not after a word character, `/` (a URL path's `/#fragment`), `)`, `#` or `&` (an HTML entity).
const HASHTAG = /(?<![\p{L}\p{N}_/)#&])#([\p{L}\p{N}_]+)/gu
// Spans whose `#` is never a hashtag: fenced and inline markdown code, and URLs.
const SKIPPED = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|\b[a-z][a-z0-9+.-]*:\/\/\S+/gi

/**
 * Every valid `#tag` in a text: at the start or after whitespace or punctuation,
 * never inside a word, a URL or markdown code. Unicode letters count (`#löpning`),
 * in NFC: a decomposed accent ends the tag, so normalise the text first.
 */
export const findHashtags = (source: string): HashtagMatch[] => {
  const skipped: [number, number][] = []
  for (const m of source.matchAll(SKIPPED)) skipped.push([m.index, m.index + m[0].length])
  const matches: HashtagMatch[] = []
  for (const m of source.matchAll(HASHTAG)) {
    if (skipped.some(([start, end]) => m.index >= start && m.index < end)) continue
    const written = m[1]
    const tag = written.toLowerCase()
    if (isValidHashtag(tag)) matches.push({ index: m.index, tag, text: written })
  }
  return matches
}

/** The distinct stored tags typed in a text, first-seen order, uncapped. */
export const extractHashtags = (text: string): string[] => [
  ...new Set(findHashtags(text.normalize('NFC')).map((match) => match.tag)),
]
