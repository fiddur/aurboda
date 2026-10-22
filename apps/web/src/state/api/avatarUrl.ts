/**
 * Pure avatar-URL builder, kept free of `config`/`window` imports so it's
 * unit-testable in a non-browser environment.
 *
 * The avatar is served at `/u/:username/avatar.png` on the same origin that
 * serves the API — `API_URL` is `/api` (same origin) in production and an
 * absolute backend URL in dev, so resolve the path against the API origin.
 */
export const buildAvatarUrl = (username: string, apiUrl: string, pageOrigin: string): string => {
  const path = `/u/${encodeURIComponent(username)}/avatar.png`
  try {
    return new URL(path, new URL(apiUrl, pageOrigin).origin).toString()
  } catch {
    return path
  }
}
