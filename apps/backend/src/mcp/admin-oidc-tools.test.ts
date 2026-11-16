import { describe, expect, test, vi } from 'vitest'

import type { OidcProviderAdmin } from '../services/oidc-providers.ts'
import type { McpServer } from './helpers.ts'

import { registerAdminOidcTools } from './admin-oidc-tools.ts'

type ToolHandler = (
  params: Record<string, unknown>,
) => Promise<{ content: { text: string }[]; isError?: boolean }>

const setup = (isAdmin: boolean) => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  const providers: OidcProviderAdmin = {
    add: vi.fn(async () => ({
      error: 'The issuer must be an https URL',
      ok: false as const,
      status: 400 as const,
    })),
    list: vi.fn(async () => []),
    redirectUri: 'https://aurboda.test/api/auth/oidc/callback',
    remove: vi.fn(async () => ({ ok: true as const, removed_links: 2, stranded_users: 0 })),
    update: vi.fn(async () => ({ error: 'Provider not found', ok: false as const, status: 404 as const })),
  }
  registerAdminOidcTools(server, 'fiddur', { isAdmin: async () => isAdmin }, providers)
  const call = (name: string, params: Record<string, unknown> = {}) => tools.get(name)!(params)
  return { call, providers, tools }
}

describe('admin OIDC tools', () => {
  test('registers the four tools', () => {
    expect([...setup(true).tools.keys()].sort()).toEqual([
      'add_oidc_provider',
      'delete_oidc_provider',
      'list_oidc_providers',
      'update_oidc_provider',
    ])
  })

  test('refuses a non-admin without touching the providers', async () => {
    const { call, providers } = setup(false)
    for (const name of [
      'list_oidc_providers',
      'add_oidc_provider',
      'update_oidc_provider',
      'delete_oidc_provider',
    ]) {
      const result = await call(name, { id: 'google' })
      expect(result.content[0].text).toContain('Admin permission required')
    }
    expect(providers.list).not.toHaveBeenCalled()
    expect(providers.remove).not.toHaveBeenCalled()
  })

  test('lists with the redirect URI, and passes errors and results through', async () => {
    const { call, providers } = setup(true)
    expect(JSON.parse((await call('list_oidc_providers')).content[0].text)).toEqual({
      providers: [],
      redirect_uri: 'https://aurboda.test/api/auth/oidc/callback',
      success: true,
    })
    const added = await call('add_oidc_provider', { issuer: 'http://x' })
    expect(added.content[0].text).toContain('https')
    await call('update_oidc_provider', { display_name: 'G', id: 'google' })
    expect(providers.update).toHaveBeenCalledWith('google', { display_name: 'G' })
    const removed = await call('delete_oidc_provider', { force: true, id: 'google' })
    expect(providers.remove).toHaveBeenCalledWith('google', true)
    expect(JSON.parse(removed.content[0].text)).toMatchObject({ removed_links: 2 })
  })
})
