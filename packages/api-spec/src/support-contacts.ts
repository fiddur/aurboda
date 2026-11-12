/**
 * How users reach the admin of a server outside GitHub, shared by the backend
 * (which validates and stores them) and the web (which shows them). Each
 * normaliser returns the stored form, `''` for blank input (unset), or null
 * when the input is not a valid handle.
 */

const FEDIVERSE_HANDLE = /^([A-Za-z0-9_.-]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)*)$/

/** `@name@example.social` or `name@example.social` → `name@example.social` (host lowercased). */
export const normalizeFediverseHandle = (value: string): string | null => {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  const at = trimmed.lastIndexOf('@')
  if (at <= 0) return null
  const handle = `${trimmed.slice(0, at).replace(/^@/, '')}@${trimmed.slice(at + 1).toLowerCase()}`
  return FEDIVERSE_HANDLE.test(handle) ? handle : null
}

const REDDIT_USERNAME = /^[A-Za-z0-9_-]{3,20}$/
const REDDIT_PROFILE_URL = /^(?:https?:\/\/)?(?:(?:www|old|new)\.)?reddit\.com\/(?:u|user)\/([^/?#]+)\/?$/i
const REDDIT_PREFIXED = /^\/?u\/([^/?#]+)\/?$/i

/** `name`, `u/name`, `/u/name` or a reddit.com profile URL → `name`. */
export const normalizeRedditUsername = (value: string): string | null => {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  const name = REDDIT_PROFILE_URL.exec(trimmed)?.[1] ?? REDDIT_PREFIXED.exec(trimmed)?.[1] ?? trimmed
  return REDDIT_USERNAME.test(name) ? name : null
}
