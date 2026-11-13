import type { Notification, NotificationsResponse } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { badgeText, bellLabel, isInAppLink, markAllReadInPage, markReadInPage } from './notifications'

const notification = (id: string, overrides: Partial<Notification> = {}): Notification => ({
  body: null,
  created_at: '2026-11-01T10:00:00.000Z',
  data: null,
  id,
  in_app: true,
  link: null,
  push: true,
  read_at: null,
  title: `n${id}`,
  type: 'admin_signup',
  ...overrides,
})

const page = (notifications: Notification[], unread: number): NotificationsResponse => ({
  next_cursor: null,
  notifications,
  success: true,
  unread_count: unread,
})

const READ_AT = '2026-11-02T10:00:00.000Z'

describe('badgeText', () => {
  it('is empty at zero, the count up to nine and 9+ above', () => {
    expect(badgeText(0)).toBe('')
    expect(badgeText(1)).toBe('1')
    expect(badgeText(9)).toBe('9')
    expect(badgeText(10)).toBe('9+')
  })
})

describe('bellLabel', () => {
  it('names the unread count when there is one', () => {
    expect(bellLabel(0)).toBe('Notifications')
    expect(bellLabel(3)).toBe('Notifications, 3 unread')
  })
})

describe('isInAppLink', () => {
  it('accepts app paths only', () => {
    expect(isInAppLink('/admin/users/bob')).toBe(true)
    expect(isInAppLink('//evil.example')).toBe(false)
    expect(isInAppLink('https://evil.example')).toBe(false)
    expect(isInAppLink(null)).toBe(false)
  })
})

describe('markReadInPage', () => {
  it('marks the row and lowers the unread count', () => {
    const next = markReadInPage(page([notification('a'), notification('b')], 2), 'a', READ_AT)
    expect(next.notifications.map((n) => n.read_at)).toEqual([READ_AT, null])
    expect(next.unread_count).toBe(1)
  })

  it('keeps the count for an already read row or one not on the page', () => {
    const read = notification('a', { read_at: '2026-11-01T11:00:00.000Z' })
    expect(markReadInPage(page([read], 4), 'a', READ_AT)).toMatchObject({
      notifications: [{ read_at: '2026-11-01T11:00:00.000Z' }],
      unread_count: 4,
    })
    expect(markReadInPage(page([], 4), 'x', READ_AT).unread_count).toBe(4)
  })
})

describe('markAllReadInPage', () => {
  it('marks every unread row and zeroes the count', () => {
    const read = notification('b', { read_at: '2026-11-01T11:00:00.000Z' })
    const next = markAllReadInPage(page([notification('a'), read], 1), READ_AT)
    expect(next.notifications.map((n) => n.read_at)).toEqual([READ_AT, '2026-11-01T11:00:00.000Z'])
    expect(next.unread_count).toBe(0)
  })
})
