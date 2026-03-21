/**
 * OAuth 2.1 service for MCP authentication.
 *
 * Implements authorization code flow with PKCE (S256) for Claude.ai
 * custom connectors and other OAuth 2.1 clients.
 */
import { createHash, randomBytes } from 'node:crypto'

import type { CentralDb } from './central-db.ts'

// ============================================================================
// Types
// ============================================================================

export interface OAuthDeps {
  centralDb: CentralDb
}

export interface RegisterClientInput {
  client_name: string
  redirect_uris: string[]
  token_endpoint_auth_method?: string
}

export interface RegisterClientResult {
  client_id: string
  client_name: string
  redirect_uris: string[]
  token_endpoint_auth_method: string
}

export interface CreateAuthCodeParams {
  client_id: string
  username: string
  redirect_uri: string
  code_challenge: string
  code_challenge_method: string
}

export interface ExchangeCodeParams {
  code: string
  client_id: string
  redirect_uri: string
  code_verifier: string
}

export interface TokenResult {
  access_token: string
  token_type: 'bearer'
  expires_in: number
  refresh_token: string
}

export interface RefreshTokenParams {
  refresh_token: string
  client_id: string
}

// ============================================================================
// Constants
// ============================================================================

const ACCESS_TOKEN_LIFETIME_SECONDS = 3600 // 1 hour
const REFRESH_TOKEN_LIFETIME_SECONDS = 30 * 24 * 3600 // 30 days
const AUTH_CODE_LIFETIME_SECONDS = 600 // 10 minutes

const ACCESS_TOKEN_PREFIX = 'aur_at_'
const REFRESH_TOKEN_PREFIX = 'aur_rt_'

// ============================================================================
// Helpers
// ============================================================================

const generateToken = (prefix: string): string => prefix + randomBytes(32).toString('base64url')

const generateClientId = (): string => 'aur_' + randomBytes(16).toString('base64url')

const generateAuthCode = (): string => randomBytes(32).toString('base64url')

const verifyPkceS256 = (codeVerifier: string, codeChallenge: string): boolean => {
  const computed = createHash('sha256').update(codeVerifier).digest('base64url')
  return computed === codeChallenge
}

// ============================================================================
// Service functions
// ============================================================================

export const registerClient = async (
  deps: OAuthDeps,
  input: RegisterClientInput,
): Promise<RegisterClientResult> => {
  const clientId = generateClientId()
  const authMethod = input.token_endpoint_auth_method ?? 'none'

  await deps.centralDb.createOAuthClient({
    client_id: clientId,
    client_name: input.client_name,
    redirect_uris: input.redirect_uris,
    token_endpoint_auth_method: authMethod,
  })

  return {
    client_id: clientId,
    client_name: input.client_name,
    redirect_uris: input.redirect_uris,
    token_endpoint_auth_method: authMethod,
  }
}

export const createAuthorizationCode = async (
  deps: OAuthDeps,
  params: CreateAuthCodeParams,
): Promise<string> => {
  const client = await deps.centralDb.getOAuthClient(params.client_id)
  if (!client) {
    throw new Error('Unknown client_id')
  }

  if (!client.redirect_uris.includes(params.redirect_uri)) {
    throw new Error('Invalid redirect_uri')
  }

  if (params.code_challenge_method !== 'S256') {
    throw new Error('Only S256 code_challenge_method is supported')
  }

  const code = generateAuthCode()
  const expiresAt = new Date(Date.now() + AUTH_CODE_LIFETIME_SECONDS * 1000)

  await deps.centralDb.saveAuthorizationCode({
    code,
    client_id: params.client_id,
    username: params.username,
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    code_challenge_method: params.code_challenge_method,
    expires_at: expiresAt,
  })

  return code
}

export const exchangeAuthorizationCode = async (
  deps: OAuthDeps,
  params: ExchangeCodeParams,
): Promise<TokenResult> => {
  const authCode = await deps.centralDb.consumeAuthorizationCode(params.code)
  if (!authCode) {
    throw new Error('Invalid or expired authorization code')
  }

  if (authCode.client_id !== params.client_id) {
    throw new Error('client_id mismatch')
  }

  if (authCode.redirect_uri !== params.redirect_uri) {
    throw new Error('redirect_uri mismatch')
  }

  if (!verifyPkceS256(params.code_verifier, authCode.code_challenge)) {
    throw new Error('PKCE verification failed')
  }

  const accessToken = generateToken(ACCESS_TOKEN_PREFIX)
  const refreshToken = generateToken(REFRESH_TOKEN_PREFIX)
  const now = Date.now()

  await deps.centralDb.saveOAuthToken({
    token: accessToken,
    token_type: 'access',
    client_id: authCode.client_id,
    username: authCode.username,
    expires_at: new Date(now + ACCESS_TOKEN_LIFETIME_SECONDS * 1000),
    revoked: false,
    parent_token: null,
    created_at: new Date(now),
  })

  await deps.centralDb.saveOAuthToken({
    token: refreshToken,
    token_type: 'refresh',
    client_id: authCode.client_id,
    username: authCode.username,
    expires_at: new Date(now + REFRESH_TOKEN_LIFETIME_SECONDS * 1000),
    revoked: false,
    parent_token: accessToken,
    created_at: new Date(now),
  })

  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: ACCESS_TOKEN_LIFETIME_SECONDS,
    refresh_token: refreshToken,
  }
}

export const refreshAccessToken = async (
  deps: OAuthDeps,
  params: RefreshTokenParams,
): Promise<TokenResult> => {
  const oldRefresh = await deps.centralDb.getOAuthToken(params.refresh_token)
  if (!oldRefresh || oldRefresh.token_type !== 'refresh') {
    throw new Error('Invalid or expired refresh token')
  }

  if (oldRefresh.client_id !== params.client_id) {
    throw new Error('client_id mismatch')
  }

  // Revoke old tokens (rotation)
  await deps.centralDb.revokeOAuthToken(params.refresh_token)
  if (oldRefresh.parent_token) {
    await deps.centralDb.revokeOAuthToken(oldRefresh.parent_token)
  }

  const accessToken = generateToken(ACCESS_TOKEN_PREFIX)
  const refreshToken = generateToken(REFRESH_TOKEN_PREFIX)
  const now = Date.now()

  await deps.centralDb.saveOAuthToken({
    token: accessToken,
    token_type: 'access',
    client_id: oldRefresh.client_id,
    username: oldRefresh.username,
    expires_at: new Date(now + ACCESS_TOKEN_LIFETIME_SECONDS * 1000),
    revoked: false,
    parent_token: null,
    created_at: new Date(now),
  })

  await deps.centralDb.saveOAuthToken({
    token: refreshToken,
    token_type: 'refresh',
    client_id: oldRefresh.client_id,
    username: oldRefresh.username,
    expires_at: new Date(now + REFRESH_TOKEN_LIFETIME_SECONDS * 1000),
    revoked: false,
    parent_token: accessToken,
    created_at: new Date(now),
  })

  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: ACCESS_TOKEN_LIFETIME_SECONDS,
    refresh_token: refreshToken,
  }
}

export const validateAccessToken = async (deps: OAuthDeps, token: string): Promise<string | null> => {
  const oauthToken = await deps.centralDb.getOAuthToken(token)
  if (!oauthToken || oauthToken.token_type !== 'access') {
    return null
  }
  return oauthToken.username
}

export const isOAuthAccessToken = (token: string): boolean => token.startsWith(ACCESS_TOKEN_PREFIX)
