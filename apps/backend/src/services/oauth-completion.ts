/**
 * A provider's OAuth redirect carries no Aurboda login, so its callback only hands the code and
 * state to the signed-in page (`handOverOAuthCallback`), which finishes the sign-in through an
 * authenticated POST whose answer is an `OAuthCompletion`.
 */

export type OAuthRefusal = 'not_configured' | 'invalid_state' | 'wrong_user' | 'auth_failed'

export type OAuthCompletion = { ok: true } | { ok: false; reason: OAuthRefusal }

export type OAuthHandOverProvider = 'garmin' | 'gravl' | 'oura' | 'strava'

/** A repeated parameter arrives as an array, and counts as missing rather than being stringified. */
const single = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

/**
 * Where the callback sends the browser: the provider's page with `<provider>_code` and
 * `<provider>_state`, or with `error` when the sign-in failed, the server has no credentials or
 * the state does not verify. Makes no request to the provider and stores nothing.
 */
export const handOverOAuthCallback = async (
  query: unknown,
  provider: OAuthHandOverProvider,
  checkState: (state: string) => Promise<'not_configured' | 'invalid_state' | null>,
): Promise<string> => {
  const page = `/data-sources/${provider}`
  const params = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>
  const code = single(params.code)
  const state = single(params.state)
  if (params.error !== undefined || !code || !state) return `${page}?error=auth_failed`

  const refusal = await checkState(state)
  if (refusal) return `${page}?error=${refusal}`

  const handOver = new URLSearchParams({ [`${provider}_code`]: code, [`${provider}_state`]: state })
  return `${page}?${handOver.toString()}`
}
