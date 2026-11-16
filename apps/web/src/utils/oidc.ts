import type { OidcErrorCode, OidcLink, OidcPreset, OidcPublicProvider } from '@aurboda/api-spec'

const ERROR_MESSAGES: Record<OidcErrorCode, string> = {
  already_linked: 'That sign-in is already linked to another account here.',
  domain_not_allowed:
    'That account is not allowed here: its email is not verified, or not in a domain this server accepts.',
  expired: 'The sign-in took too long or was already used. Please try again.',
  failed: 'The sign-in did not succeed. Please try again.',
  not_linked:
    'No account here is linked to that sign-in. Log in another way, then link it under Settings → Linked sign-in providers.',
  signup_closed: 'No account is linked to that sign-in, and new accounts cannot be created here right now.',
}

/** The readable message for an `?oidc_error=` code, or null when there is none. */
export const oidcErrorMessage = (code: string | undefined): string | null => {
  if (!code) return null
  return code in ERROR_MESSAGES ? ERROR_MESSAGES[code as OidcErrorCode] : ERROR_MESSAGES.failed
}

/** The one-time code the server put in the URL fragment (`#code=…`), or null. */
export const codeFromHash = (hash: string): string | null => {
  const code = new URLSearchParams(hash.replace(/^#/, '')).get('code')
  return code ? code : null
}

const VERIFIER_KEY = 'aurboda_oidc_verifier'

type VerifierStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

const browserStorage = (): VerifierStorage | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Keeps the verifier `start` answered with, for the page the provider sends this browser back to.
 * localStorage rather than sessionStorage: a provider's app can hand the redirect back in a new tab.
 */
export const rememberOidcVerifier = (verifier: string, storage = browserStorage()): void => {
  try {
    storage?.setItem(VERIFIER_KEY, verifier)
  } catch {
    // Without storage the return page says the sign-in was not started in this browser.
  }
}

/** The remembered verifier, removed as it is read, or null when this browser started no sign-in. */
export const takeOidcVerifier = (storage = browserStorage()): string | null => {
  try {
    const verifier = storage?.getItem(VERIFIER_KEY) ?? null
    storage?.removeItem(VERIFIER_KEY)
    return verifier || null
  } catch {
    return null
  }
}

/** The enabled providers the user has not linked yet. */
export const unlinkedProviders = (providers: OidcPublicProvider[], links: OidcLink[]): OidcPublicProvider[] =>
  providers.filter((provider) => !links.some((link) => link.provider_id === provider.id))

/** Whether removing one more login method would leave the account with none. */
export const isLastLoginMethod = (loginMethods: number): boolean => loginMethods <= 1

export const OIDC_PRESETS: Record<OidcPreset, { display_name: string; issuer: string; id: string }> = {
  google: { display_name: 'Google', id: 'google', issuer: 'https://accounts.google.com' },
}

/** Comma, space or newline separated domains, lowercased, without duplicates. */
export const parseEmailDomains = (text: string): string[] => [
  ...new Set(
    text
      .split(/[\s,]+/)
      .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean),
  ),
]
