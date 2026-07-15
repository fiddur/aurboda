/**
 * Support for running the web app embedded inside the native Android app's
 * WebView. The native shell loads pages with `?embed=1` and exposes an auth
 * bridge (`window.AurbodaNative`) so the WebView shares the app's bearer token
 * without a second login. In embed mode the web chrome (header/sidebar/footer)
 * is hidden because the native app supplies navigation — see AppShell.
 */

declare global {
  interface Window {
    /** Bridge injected by the Android app's WebView (see EmbeddedWebScreen.kt). */
    AurbodaNative?: { getAuth?: () => string | null }
  }
}

const EMBED_QUERY_KEY = 'embed'
const EMBED_STORAGE_KEY = 'aurboda_embed'

/**
 * Pure: is this an embedded (native WebView) session? The native app appends
 * `?embed=1` on the initial load; `stored` carries a previously-detected flag so
 * the mode survives client-side navigation that drops the query string.
 */
export function computeEmbedded(search: string, stored: string | null): boolean {
  const params = new URLSearchParams(search)
  if (params.get(EMBED_QUERY_KEY) === '1') return true
  return stored === '1'
}

let embeddedCache: boolean | undefined

/**
 * Whether the web app is running inside the Android app's WebView. Detected once
 * from the initial URL and persisted to sessionStorage so it holds across
 * client-side navigation.
 */
export function isEmbedded(): boolean {
  if (embeddedCache !== undefined) return embeddedCache
  const stored = sessionStorage.getItem(EMBED_STORAGE_KEY)
  const embedded = computeEmbedded(window.location.search, stored)
  if (embedded) sessionStorage.setItem(EMBED_STORAGE_KEY, '1')
  embeddedCache = embedded
  return embedded
}

export interface EmbedAuth {
  user?: string
  token?: string
  is_admin?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Pure: parse the JSON handed over by the native auth bridge into an auth state.
 * Returns null for missing/malformed input or a payload without a token, so
 * callers fall back to browser-stored credentials.
 */
export function parseNativeAuth(raw: string | null | undefined): EmbedAuth | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const { token, user, is_admin } = parsed
  if (typeof token !== 'string' || token === '') return null
  return {
    is_admin: typeof is_admin === 'boolean' ? is_admin : undefined,
    token,
    user: typeof user === 'string' ? user : undefined,
  }
}

/** Read auth handed over by the native WebView bridge, if present. */
export function readNativeAuth(): EmbedAuth | null {
  const bridge = window.AurbodaNative
  if (!bridge?.getAuth) return null
  try {
    return parseNativeAuth(bridge.getAuth())
  } catch {
    return null
  }
}
