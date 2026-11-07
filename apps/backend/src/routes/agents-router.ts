import { readFileSync } from 'node:fs'

import { type TypedRouter, typedRouter } from '../typed-router.ts'

export const API_URL_PLACEHOLDER = '__AURBODA_API_URL__'

const readTemplate = (name: string): string =>
  readFileSync(new URL(`../agents/${name}`, import.meta.url), 'utf8')

export const renderAgentScript = (template: string, apiBaseUrl: string): string =>
  template.replaceAll(API_URL_PLACEHOLDER, apiBaseUrl.replace(/\/+$/, ''))

/**
 * Public installers for the ActivityWatch push agent, served with this server's API base URL
 * filled in. No MCP twin: a script piped into a shell, like the OpenAPI document.
 */
export const createAgentsRouter = (apiBaseUrl: string): TypedRouter => {
  const router = typedRouter()
  const shellScript = renderAgentScript(readTemplate('activitywatch.sh'), apiBaseUrl)
  const powershellScript = renderAgentScript(readTemplate('activitywatch.ps1'), apiBaseUrl)

  router.get<Record<string, never>, string>('/agents/activitywatch.sh', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.type('text/x-shellscript; charset=utf-8').send(shellScript)
  })

  router.get<Record<string, never>, string>('/agents/activitywatch.ps1', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.type('text/plain; charset=utf-8').send(powershellScript)
  })

  return router
}
