const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const ALLOWED_POSTS = new Set([
  '/account/email/verification',
  '/autoshare-rules/preview',
  '/deduction-rules/preview',
  '/feed/dashboards/preview',
  '/feed/exercises/preview',
  '/notifications/push/subscriptions',
  '/notifications/push/test',
])
const ACTIVITY_SHARE_PREVIEW = /^\/feed\/activities\/[^/]+\/preview$/
const NOTIFICATION_READ = /^\/notifications\/(read-all|[^/]+\/read)$/
const NOTIFICATION_PREFERENCE = /^\/notifications\/types\/[^/]+$/
const PUSH_SUBSCRIPTION = /^\/notifications\/push\/subscriptions\/[^/]+$/

const isAllowedForAnyWrite = (path: string): boolean =>
  path === '/export' ||
  path.startsWith('/export/') ||
  path.startsWith('/webauthn/') ||
  path.startsWith('/account/oidc/')

const ALLOWED_WRITES: Record<string, readonly ((path: string) => boolean)[]> = {
  DELETE: [(path) => path === '/account' || path === '/account/', (path) => PUSH_SUBSCRIPTION.test(path)],
  POST: [
    (path) => ALLOWED_POSTS.has(path),
    (path) => ACTIVITY_SHARE_PREVIEW.test(path),
    (path) => NOTIFICATION_READ.test(path),
  ],
  PUT: [(path) => path === '/account/email', (path) => NOTIFICATION_PREFERENCE.test(path)],
}

/**
 * Whether a request is allowed for a read-only account: every read, plus the previews that
 * store nothing, exporting the data, deleting the account, managing passkeys and linked sign-in providers, setting and
 * verifying the account's email and managing its notification preferences and browser push (so an expired
 * account can still be reached about renewing: push is how it hears that its plan needs renewing), and
 * marking notifications read (the reminders about its plan are addressed to exactly this account). A
 * notification's actions stay refused, since running one writes data. The
 * backend's account gate enforces it and the OpenAPI generator documents its 402 from it.
 */
export const isAllowedWhenReadOnly = (method: string, path: string): boolean => {
  const verb = method.toUpperCase()
  if (SAFE_METHODS.has(verb) || isAllowedForAnyWrite(path)) return true
  return (ALLOWED_WRITES[verb] ?? []).some((allowed) => allowed(path))
}
