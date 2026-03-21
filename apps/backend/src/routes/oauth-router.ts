/**
 * OAuth 2.1 router for MCP authentication.
 *
 * Provides endpoints required by the MCP spec for OAuth 2.1 authorization
 * server discovery, authorization, token exchange, and dynamic client
 * registration. Endpoints are mounted at the domain root level.
 */
import express, { Router, type Request, type Response } from 'express'

import type { CentralDb } from '../services/central-db.ts'

import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  refreshAccessToken,
  registerClient,
} from '../services/oauth.ts'

// ============================================================================
// Types
// ============================================================================

export interface OAuthRouterDeps {
  centralDb: CentralDb
  loginToUserDb: (username: string, password: string) => Promise<unknown>
  webHost: string
}

// ============================================================================
// Login form HTML
// ============================================================================

const loginFormHtml = (params: {
  client_id: string
  redirect_uri: string
  state: string
  code_challenge: string
  code_challenge_method: string
  error?: string
}) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aurboda — Sign In</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #1e293b; border-radius: 12px; padding: 2rem; width: 100%; max-width: 400px; box-shadow: 0 4px 24px rgba(0,0,0,0.3); }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p.sub { color: #94a3b8; margin-bottom: 1.5rem; font-size: 0.9rem; }
    label { display: block; margin-bottom: 0.25rem; font-size: 0.875rem; color: #94a3b8; }
    input[type="text"], input[type="password"] { width: 100%; padding: 0.6rem 0.75rem; border: 1px solid #334155; border-radius: 6px; background: #0f172a; color: #e2e8f0; font-size: 1rem; margin-bottom: 1rem; }
    input:focus { outline: none; border-color: #6366f1; }
    button { width: 100%; padding: 0.7rem; border: none; border-radius: 6px; background: #6366f1; color: white; font-size: 1rem; cursor: pointer; font-weight: 500; }
    button:hover { background: #4f46e5; }
    .error { background: #7f1d1d; color: #fca5a5; padding: 0.6rem 0.75rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Aurboda</h1>
    <p class="sub">Sign in to authorize access to your health data.</p>
    ${params.error ? `<div class="error">${params.error}</div>` : ''}
    <form method="POST" action="/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(params.client_id)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirect_uri)}">
      <input type="hidden" name="state" value="${escapeHtml(params.state)}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(params.code_challenge)}">
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(params.code_challenge_method)}">
      <label for="username">Username</label>
      <input type="text" id="username" name="username" required autocomplete="username">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required autocomplete="current-password">
      <button type="submit">Sign In</button>
    </form>
  </div>
</body>
</html>`

const escapeHtml = (str: string): string =>
  str.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

// ============================================================================
// Router factory
// ============================================================================

export const createOAuthRouter = (deps: OAuthRouterDeps): Router => {
  const { centralDb, loginToUserDb, webHost } = deps
  const router = Router()
  const oauthDeps = { centralDb }

  // OAuth metadata discovery
  router.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
    const issuer = webHost
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    })
  })

  // Authorization endpoint — GET serves login form
  router.get('/authorize', (req: Request, res: Response) => {
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method } = req.query as Record<
      string,
      string
    >

    if (!client_id || !redirect_uri || !code_challenge || !code_challenge_method) {
      res.status(400).send('Missing required OAuth parameters')
      return
    }

    res.type('html').send(
      loginFormHtml({
        client_id,
        redirect_uri,
        state: state ?? '',
        code_challenge,
        code_challenge_method,
      }),
    )
  })

  // Authorization endpoint — POST handles login + redirect
  router.post('/authorize', express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, username, password } =
      req.body

    if (!client_id || !redirect_uri || !code_challenge || !code_challenge_method || !username || !password) {
      res.status(400).send('Missing required parameters')
      return
    }

    // Authenticate user
    try {
      await loginToUserDb(username, password)
    } catch {
      res.type('html').send(
        loginFormHtml({
          client_id,
          redirect_uri,
          state: state ?? '',
          code_challenge,
          code_challenge_method,
          error: 'Invalid username or password',
        }),
      )
      return
    }

    // Generate authorization code
    try {
      const code = await createAuthorizationCode(oauthDeps, {
        client_id,
        username,
        redirect_uri,
        code_challenge,
        code_challenge_method,
      })

      const redirectUrl = new URL(redirect_uri)
      redirectUrl.searchParams.set('code', code)
      if (state) {
        redirectUrl.searchParams.set('state', state)
      }

      res.redirect(302, redirectUrl.toString())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authorization failed'
      res.status(400).json({ error: message })
    }
  })

  // Token endpoint
  router.post('/token', express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
    const { grant_type } = req.body

    try {
      if (grant_type === 'authorization_code') {
        const { code, client_id, redirect_uri, code_verifier } = req.body
        if (!code || !client_id || !redirect_uri || !code_verifier) {
          res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' })
          return
        }

        const result = await exchangeAuthorizationCode(oauthDeps, {
          code,
          client_id,
          redirect_uri,
          code_verifier,
        })

        res.json(result)
      } else if (grant_type === 'refresh_token') {
        const { refresh_token, client_id } = req.body
        if (!refresh_token || !client_id) {
          res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' })
          return
        }

        const result = await refreshAccessToken(oauthDeps, { refresh_token, client_id })
        res.json(result)
      } else {
        res.status(400).json({ error: 'unsupported_grant_type' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Token exchange failed'
      res.status(400).json({ error: 'invalid_grant', error_description: message })
    }
  })

  // Dynamic client registration (RFC 7591)
  router.post('/register', express.json(), async (req: Request, res: Response) => {
    const { client_name, redirect_uris, token_endpoint_auth_method } = req.body

    if (!client_name || !redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      res
        .status(400)
        .json({
          error: 'invalid_client_metadata',
          error_description: 'client_name and redirect_uris are required',
        })
      return
    }

    try {
      const result = await registerClient(oauthDeps, {
        client_name,
        redirect_uris,
        token_endpoint_auth_method,
      })

      res.status(201).json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed'
      res.status(400).json({ error: 'invalid_client_metadata', error_description: message })
    }
  })

  return router
}
