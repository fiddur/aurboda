const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const PREVIEW_POSTS = new Set([
  '/autoshare-rules/preview',
  '/deduction-rules/preview',
  '/feed/dashboards/preview',
  '/feed/exercises/preview',
])
const ACTIVITY_SHARE_PREVIEW = /^\/feed\/activities\/[^/]+\/preview$/
const NOTIFICATION_READ = /^\/notifications\/(read-all|[^/]+\/read)$/

/**
 * Whether a request is allowed for a read-only account: every read, plus the previews that
 * store nothing, exporting the data, deleting the account, managing passkeys and setting the
 * account's email (so an expired account can still be reached about renewing), and marking
 * notifications read (the reminders about its plan are addressed to exactly this account). The
 * backend's account gate enforces it and the OpenAPI generator documents its 402 from it.
 */
export const isAllowedWhenReadOnly = (method: string, path: string): boolean => {
  const verb = method.toUpperCase()
  if (SAFE_METHODS.has(verb)) return true
  if (path === '/export' || path.startsWith('/export/')) return true
  if (path.startsWith('/webauthn/')) return true
  if (verb === 'POST' && (PREVIEW_POSTS.has(path) || ACTIVITY_SHARE_PREVIEW.test(path))) return true
  if (verb === 'PUT' && path === '/account/email') return true
  if (verb === 'POST' && NOTIFICATION_READ.test(path)) return true
  return verb === 'DELETE' && (path === '/account' || path === '/account/')
}
