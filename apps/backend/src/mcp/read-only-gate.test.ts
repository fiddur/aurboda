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
    'send_email_verification',
    'list_notifications',
    'mark_notification_read',
    'mark_all_notifications_read',
    'list_reminders',
    'search_notes',
    'list_deleted_notes',
    'list_note_revisions',
    'list_check_in_forms',
    'get_check_in_form',
    'list_check_in_templates',
    'query_check_ins',
    'list_due',
    'get_note_attachment',
    'list_deleted_note_attachments',
    'list_note_templates',
  ])('allows %s', (name) => expect(isToolAllowedWhenReadOnly(name)).toBe(true))

  test.each([
    'add_metric',
    'update_activity',
    'delete_note',
    'sync_oura',
    'set_tag_mapping',
    'set_notification_preference',
    'run_notification_action',
    'skip_autoshare',
    'add_reminder',
    'update_reminder',
    'delete_reminder',
    'restore_note',
    'add_check_in_form',
    'update_check_in_form',
    'delete_check_in_form',
    'restore_check_in_form',
    'submit_check_in',
    'update_check_in',
    'delete_check_in',
    'restore_check_in',
    'add_note_attachment',
    'delete_note_attachment',
    'restore_note_attachment',
    'add_note_template',
    'update_note_template',
    'delete_note_template',
    'restore_note_template',
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
