import * as client from 'openid-client'

export interface OidcIdentity {
  iss: string
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
}

export interface OidcAuthorizationParams {
  redirectUri: string
  state: string
  nonce: string
  codeVerifier: string
}

export interface OidcProviderClient {
  authorizationUrl: (params: OidcAuthorizationParams) => Promise<string>
  /** Trades the code in `callbackUrl` and validates the ID token (signature, iss, aud, exp, nonce). */
  exchange: (callbackUrl: URL, checks: Omit<OidcAuthorizationParams, 'redirectUri'>) => Promise<OidcIdentity>
}

export interface OidcClient {
  discover: (issuer: string, clientId: string, clientSecret: string) => Promise<OidcProviderClient>
}

/** Why the issuer cannot be used, or null: it must be an https URL (http only when allowed, for local testing). */
export const issuerUrlProblem = (issuer: string, allowHttp: boolean): string | null => {
  let url: URL
  try {
    url = new URL(issuer)
  } catch {
    return 'The issuer is not a URL'
  }
  if (url.protocol === 'https:' || (url.protocol === 'http:' && allowHttp)) return null
  return 'The issuer must be an https URL'
}

export const allowHttpIssuer = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.OIDC_ALLOW_HTTP_ISSUER === 'true'

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const asVerified = (value: unknown): boolean | undefined =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : undefined

export const createOidcClient = ({ allowHttp }: { allowHttp: boolean }): OidcClient => ({
  discover: async (issuer, clientId, clientSecret) => {
    const problem = issuerUrlProblem(issuer, allowHttp)
    if (problem) throw new Error(problem)
    const url = new URL(issuer)
    const config = await client.discovery(
      url,
      clientId,
      clientSecret,
      client.ClientSecretPost(clientSecret),
      url.protocol === 'http:' ? { execute: [client.allowInsecureRequests] } : undefined,
    )
    return {
      authorizationUrl: async ({ redirectUri, state, nonce, codeVerifier }) =>
        client
          .buildAuthorizationUrl(config, {
            code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
            code_challenge_method: 'S256',
            nonce,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'openid email profile',
            state,
          })
          .toString(),

      exchange: async (callbackUrl, { state, nonce, codeVerifier }) => {
        const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
          expectedNonce: nonce,
          expectedState: state,
          idTokenExpected: true,
          pkceCodeVerifier: codeVerifier,
        })
        const claims = tokens.claims()
        if (!claims) throw new Error('The provider returned no ID token')
        return {
          email: asString(claims.email),
          email_verified: asVerified(claims.email_verified),
          iss: claims.iss,
          name: asString(claims.name),
          sub: claims.sub,
        }
      },
    }
  },
})

export interface DiscoveryCacheKey {
  id: string
  issuer: string
  client_id: string
  client_secret: string
  updated_at: Date
}

export const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000

/** Caches a provider's discovered configuration for an hour, keyed by its id and when it last changed. */
export const createDiscoveryCache = (
  oidcClient: OidcClient,
  now: () => number = Date.now,
  ttlMs = DISCOVERY_CACHE_TTL_MS,
) => {
  const cache = new Map<string, { at: number; client: Promise<OidcProviderClient> }>()
  return (provider: DiscoveryCacheKey): Promise<OidcProviderClient> => {
    const key = `${provider.id}@${provider.updated_at.toISOString()}`
    const hit = cache.get(key)
    if (hit && now() - hit.at < ttlMs) return hit.client
    for (const cached of cache.keys()) if (cached.startsWith(`${provider.id}@`)) cache.delete(cached)
    const discovered = oidcClient.discover(provider.issuer, provider.client_id, provider.client_secret)
    cache.set(key, { at: now(), client: discovered })
    discovered.catch(() => cache.delete(key))
    return discovered
  }
}
