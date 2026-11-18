import type { AuthActionResponse } from '@aurboda/api-spec'

import { useEffect, useRef, useState } from 'preact/hooks'

import type { OAuthProvider } from '../../state/api/sync'

export type { OAuthProvider }

const returnParams = (provider: OAuthProvider) => [`${provider}_code`, `${provider}_state`] as const

/** The code and state the provider's callback hands to the page, for the signed-in user to finish with. */
export const oauthReturn = (
  search: string,
  provider: OAuthProvider,
): { code: string; state: string } | null => {
  const params = new URLSearchParams(search)
  const [codeParam, stateParam] = returnParams(provider)
  const code = params.get(codeParam)
  const state = params.get(stateParam)
  return code && state ? { code, state } : null
}

export const withoutOAuthReturn = (search: string, provider: OAuthProvider): string => {
  const params = new URLSearchParams(search)
  for (const name of returnParams(provider)) params.delete(name)
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}

/** The text for the `?error=` code a provider's callback redirects with. */
export const oauthErrorText = (code: string | null, providerName: string): string | null => {
  if (code === null) return null
  if (code === 'invalid_state') return 'The connection attempt expired. Try again.'
  if (code === 'not_configured') return `This server has not set up ${providerName} sign-in.`
  return `${providerName} did not complete the connection. Try again.`
}

/** The error text for the `?error=` code in the current address, if any. */
export const callbackErrorText = (providerName: string): string | null =>
  typeof window === 'undefined'
    ? null
    : oauthErrorText(new URLSearchParams(window.location.search).get('error'), providerName)

export interface OAuthCompletionOptions {
  provider: OAuthProvider
  providerName: string
  complete: (code: string, state: string) => Promise<AuthActionResponse>
  onChanged: () => Promise<void>
  setError: (error: string | null) => void
}

/**
 * Starts finishing a handed-over sign-in, or answers null when the address carries none. The code
 * works once, so it leaves the address before anything can fail and a reload does not replay it.
 */
export const startOAuthCompletion = (
  { provider, providerName, complete, onChanged, setError }: OAuthCompletionOptions,
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  replaceUrl: (url: string) => void,
): Promise<void> | null => {
  const handedOver = oauthReturn(location.search, provider)
  if (!handedOver) return null
  setError(null)
  replaceUrl(`${location.pathname}${withoutOAuthReturn(location.search, provider)}${location.hash}`)
  const failed = oauthErrorText('auth_failed', providerName)
  return (async () => {
    try {
      const answer = await complete(handedOver.code, handedOver.state)
      if (answer.success) await onChanged()
      else setError(answer.error ?? failed)
    } catch (err) {
      setError(err instanceof Error ? err.message : failed)
    }
  })()
}

/** Finishes a sign-in the provider's callback handed to this page, once. Answers whether it is running. */
export function useOAuthCompletion(options: OAuthCompletionOptions): boolean {
  const [finishing, setFinishing] = useState(false)
  const finishStarted = useRef(false)

  useEffect(() => {
    if (finishStarted.current) return
    const running = startOAuthCompletion(options, window.location, (url) =>
      window.history.replaceState(window.history.state, '', url),
    )
    if (!running) return
    finishStarted.current = true
    setFinishing(true)
    void running.finally(() => setFinishing(false))
  }, [options.onChanged])

  return finishing
}
