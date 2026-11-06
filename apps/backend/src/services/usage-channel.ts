import type { IncomingHttpHeaders } from 'node:http'

export type RestUsageChannel = 'web' | 'android' | 'api'

export const CLIENT_HEADER = 'x-aurboda-client'

const headerValue = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? ''

export const classifyClient = (headers: IncomingHttpHeaders): RestUsageChannel => {
  const declared = headerValue(headers[CLIENT_HEADER]).trim().toLowerCase()
  if (declared === 'web' || declared === 'android') return declared

  const userAgent = headerValue(headers['user-agent'])
  if (userAgent.includes('Mozilla/')) return 'web'
  if (/Dalvik\/|okhttp|Ktor/i.test(userAgent)) return 'android'
  return 'api'
}

export const MUTATING_MCP_TOOL_PREFIXES = [
  'ack_',
  'add_',
  'approve_',
  'backfill_',
  'boost_',
  'clear_',
  'create_',
  'delete_',
  'duplicate_',
  'evaluate_',
  'follow_',
  'import_',
  'join_',
  'like_',
  'merge_',
  'promote_',
  'recalculate_',
  'recategorize_',
  'reject_',
  'remove_',
  'rename_',
  'reply_',
  'requeue_',
  'reset_',
  'resnapshot_',
  'restore_',
  'set_',
  'share_',
  'start_',
  'sync_',
  'unboost_',
  'unfollow_',
  'unlike_',
  'update_',
] as const

export const isMutatingMcpTool = (name: string): boolean =>
  MUTATING_MCP_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Names of the tools a JSON-RPC body (one message or a batch) calls. */
export const mcpToolCallNames = (body: unknown): string[] =>
  (Array.isArray(body) ? body : [body]).flatMap((message) =>
    isRecord(message) &&
    message.method === 'tools/call' &&
    isRecord(message.params) &&
    typeof message.params.name === 'string'
      ? [message.params.name]
      : [],
  )
