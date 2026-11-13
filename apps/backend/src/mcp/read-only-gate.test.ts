import { describe, expect, test } from 'vitest'

import { isToolAllowedWhenReadOnly, readOnlyToolMessage } from './read-only-gate.ts'

describe('isToolAllowedWhenReadOnly', () => {
  test.each([
    'get_latest_sleep',
    'query_activities',
    'export_data_dump',
    'delete_my_account',
    'get_my_plan',
    'get_my_email',
    'set_my_email',
    'list_notifications',
    'mark_notification_read',
    'mark_all_notifications_read',
  ])('allows %s', (name) => expect(isToolAllowedWhenReadOnly(name)).toBe(true))

  test.each([
    'add_metric',
    'update_activity',
    'delete_note',
    'sync_oura',
    'set_tag_mapping',
    'set_notification_preference',
  ])('refuses %s', (name) => expect(isToolAllowedWhenReadOnly(name)).toBe(false))
})

describe('readOnlyToolMessage', () => {
  test('names the payment link when there is one', () => {
    expect(readOnlyToolMessage({ error: 'Read-only', payment_url: 'https://pay.example' })).toBe(
      'Read-only. Renew it at https://pay.example',
    )
    expect(readOnlyToolMessage({ error: 'Read-only', payment_url: null })).toBe('Read-only.')
  })
})
