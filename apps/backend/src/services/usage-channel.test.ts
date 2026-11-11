import { describe, expect, test } from 'vitest'

import { classifyClient, isMutatingMcpTool, mcpToolCallNames } from './usage-channel.ts'

describe('classifyClient', () => {
  test('trusts the client header first', () => {
    expect(classifyClient({ 'user-agent': 'curl/8.0', 'x-aurboda-client': 'web' })).toBe('web')
    expect(classifyClient({ 'user-agent': 'Mozilla/5.0', 'x-aurboda-client': 'android' })).toBe('android')
    expect(classifyClient({ 'x-aurboda-client': 'Android' })).toBe('android')
  })

  test('ignores an unknown client header value', () => {
    expect(classifyClient({ 'user-agent': 'curl/8.0', 'x-aurboda-client': 'toaster' })).toBe('api')
  })

  test('falls back to the user agent', () => {
    expect(classifyClient({ 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0' })).toBe('web')
    expect(classifyClient({ 'user-agent': 'Dalvik/2.1.0 (Linux; U; Android 15; Pixel 8)' })).toBe('android')
    expect(classifyClient({ 'user-agent': 'okhttp/4.12.0' })).toBe('android')
    expect(classifyClient({ 'user-agent': 'Ktor client' })).toBe('android')
  })

  test('anything else is the API', () => {
    expect(classifyClient({ 'user-agent': 'python-requests/2.32' })).toBe('api')
    expect(classifyClient({})).toBe('api')
  })
})

describe('isMutatingMcpTool', () => {
  test.each([
    'add_metric',
    'create_challenge',
    'update_meal',
    'delete_note',
    'set_tag_mapping',
    'merge_routes',
    'sync_garmin',
    'start_livsmedelsverket_import',
    'ack_outbound_sync',
    'unfollow_actor',
    'resnapshot_meals_for_food_item',
    'publish_article_draft',
    'resend_post_updates',
  ])('%s mutates', (name) => {
    expect(isMutatingMcpTool(name)).toBe(true)
  })

  test.each([
    'get_latest_sleep',
    'query_metrics',
    'list_activity_types',
    'describe_tools',
    'preview_deduction_rule',
    'discover_challenges',
    'preview_challenge',
    'match_routes',
    'export_article_markdown',
  ])('%s reads', (name) => {
    expect(isMutatingMcpTool(name)).toBe(false)
  })
})

describe('mcpToolCallNames', () => {
  test('names the tools a single message or a batch calls', () => {
    expect(
      mcpToolCallNames({ id: 1, jsonrpc: '2.0', method: 'tools/call', params: { name: 'get_trend' } }),
    ).toEqual(['get_trend'])
    expect(
      mcpToolCallNames([
        { id: 1, jsonrpc: '2.0', method: 'initialize' },
        { id: 2, jsonrpc: '2.0', method: 'tools/list' },
        { id: 3, jsonrpc: '2.0', method: 'tools/call', params: { name: 'add_note' } },
        { id: 4, jsonrpc: '2.0', method: 'tools/call', params: {} },
      ]),
    ).toEqual(['add_note'])
  })

  test('is empty for a body that is no JSON-RPC message', () => {
    expect(mcpToolCallNames(undefined)).toEqual([])
    expect(mcpToolCallNames('tools/call')).toEqual([])
  })
})
