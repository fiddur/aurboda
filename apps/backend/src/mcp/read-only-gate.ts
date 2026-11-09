import type { ReadOnlyRefusal } from '../services/account-gate.ts'
import type { McpServer } from './helpers.ts'

import { isMutatingMcpTool } from '../services/usage-channel.ts'
import { registeredTools } from './tool-catalogue.ts'

/**
 * Mutating tools a read-only account may still call: its data must stay exportable and deletable,
 * and its owner reachable about renewing.
 */
export const READ_ONLY_ALLOWED_TOOLS = new Set(['delete_my_account', 'export_data_dump', 'set_my_email'])

export const isToolAllowedWhenReadOnly = (name: string): boolean =>
  !isMutatingMcpTool(name) || READ_ONLY_ALLOWED_TOOLS.has(name)

export const readOnlyToolMessage = ({ error, payment_url }: ReadOnlyRefusal): string =>
  payment_url ? `${error}. Renew it at ${payment_url}` : `${error}.`

/** Replaces every mutating tool's handler with a tool error, so it never runs. */
export const refuseMutatingTools = (server: McpServer, refusal: ReadOnlyRefusal): void => {
  const result = { content: [{ text: readOnlyToolMessage(refusal), type: 'text' as const }], isError: true }
  for (const [name, tool] of Object.entries(registeredTools(server))) {
    if (!isToolAllowedWhenReadOnly(name)) tool.update({ callback: async () => result })
  }
}
