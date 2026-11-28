/**
 * Fediverse handles (`@user@host`) typed in authored markdown, shared by the backend (which resolves
 * them to mentions when an article is published) and every markdown renderer (which links a resolved
 * one and shows any other as plain text, never as GFM's `mailto:` autolink).
 */

const USER = '[A-Za-z0-9_.-]+'
const HOST = '(?:[A-Za-z0-9-]+\\.)+[A-Za-z0-9-]+'
// A trailing `.` is punctuation, but not when a label follows it; nor may the host run into a path,
// another `@` or a longer word.
const END = '(?!\\.?[A-Za-z0-9_@/-])'
const PRECEDING = '\\s(\\[{"\'*_~>'

const HANDLE_AT_START = new RegExp(`^@(${USER})@(${HOST})${END}`)
const HANDLE = new RegExp(`(?<=^|[${PRECEDING}])@(${USER})@(${HOST})${END}`, 'g')
const PRECEDING_CHAR = new RegExp(`[${PRECEDING}]`)

// Spans whose handles are never mentions: fenced and inline code, URLs, markdown links and images
// (their text and target), and `<…>` autolinks.
const SKIPPED =
  /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|\b[a-z][a-z0-9+.-]*:\/\/\S+|!?\[[^\]\n]*\]\([^)\n]*\)|<[^>\n]*>/gi

export interface HandleMatch {
  /** Index of the leading `@` in the searched text. */
  index: number
  /** `@user@host` as written. */
  handle: string
  username: string
  host: string
}

const toMatch = (m: RegExpMatchArray, index: number): HandleMatch => ({
  handle: m[0],
  host: m[2],
  index,
  username: m[1],
})

/** Whether a handle may start right after `char` (`undefined`: at the start of the text). */
export const canPrecedeHandle = (char: string | undefined): boolean =>
  char === undefined || char === '' || PRECEDING_CHAR.test(char)

/** The handle `text` starts with, or null; the caller checks what precedes it. */
export const handleAtStart = (text: string): HandleMatch | null => {
  const m = HANDLE_AT_START.exec(text)
  return m ? toMatch(m, 0) : null
}

/** Index of the first `@` in `text` that starts a handle after an allowed character (or at 0), else -1. */
export const handleStartIndex = (text: string): number => {
  for (let i = text.indexOf('@'); i !== -1; i = text.indexOf('@', i + 1)) {
    if ((i === 0 || canPrecedeHandle(text[i - 1])) && HANDLE_AT_START.test(text.slice(i))) return i
  }
  return -1
}

/**
 * Every `@user@host` typed in markdown: at the start or after whitespace or opening punctuation (so
 * never the tail of an e-mail address like `a@user@host`), the host having a dot, and never inside
 * code, a URL, a link or an autolink. A trailing `.` is not part of the host.
 */
export const findHandles = (markdown: string): HandleMatch[] => {
  const skipped: [number, number][] = []
  for (const m of markdown.matchAll(SKIPPED)) skipped.push([m.index, m.index + m[0].length])
  const matches: HandleMatch[] = []
  for (const m of markdown.matchAll(HANDLE)) {
    if (skipped.some(([start, end]) => m.index >= start && m.index < end)) continue
    matches.push(toMatch(m, m.index))
  }
  return matches
}

/** The key two spellings of one handle share: handles compare case-insensitively. */
export const handleKey = (handle: string): string => handle.toLowerCase()

/** The distinct handles typed across `markdowns`, first-seen order, at most `limit`. */
export const distinctHandles = (markdowns: readonly string[], limit: number): HandleMatch[] => {
  const seen = new Set<string>()
  const out: HandleMatch[] = []
  for (const markdown of markdowns) {
    for (const match of findHandles(markdown)) {
      const key = handleKey(match.handle)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(match)
      if (out.length === limit) return out
    }
  }
  return out
}
