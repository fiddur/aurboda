import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as db from './db'
import { parseICalEvents, syncAllCalendars, syncCalendar } from './ical-sync'

vi.mock('./db', () => ({
  getAllSyncStates: vi.fn().mockResolvedValue([]),
  getSyncState: vi.fn().mockResolvedValue(null),
  getUserSettings: vi.fn().mockResolvedValue(null),
  insertRawRecord: vi.fn().mockResolvedValue(undefined),
  insertTag: vi.fn().mockResolvedValue(undefined),
  upsertSyncState: vi.fn().mockResolvedValue(undefined),
}))

const sampleIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
DTSTART:20250115T100000Z
DTEND:20250115T110000Z
SUMMARY:Team Standup
UID:event-1@example.com
DESCRIPTION:Daily team standup meeting
LOCATION:Conference Room A
END:VEVENT
BEGIN:VEVENT
DTSTART:20250116T140000Z
DTEND:20250116T150000Z
SUMMARY:1:1 with Manager
UID:event-2@example.com
END:VEVENT
END:VCALENDAR`

const allDayIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250120
DTEND;VALUE=DATE:20250121
SUMMARY:Company Holiday
UID:allday-1@example.com
END:VEVENT
END:VCALENDAR`

const emptyIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
END:VCALENDAR`

describe('parseICalEvents', () => {
  test('parses VEVENT entries from ICS text', () => {
    const events = parseICalEvents(sampleIcs)

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({
      description: 'Daily team standup meeting',
      end: new Date('2025-01-15T11:00:00.000Z'),
      location: 'Conference Room A',
      start: new Date('2025-01-15T10:00:00.000Z'),
      summary: 'Team Standup',
      uid: 'event-1@example.com',
    })
    expect(events[1]).toEqual({
      description: undefined,
      end: new Date('2025-01-16T15:00:00.000Z'),
      location: undefined,
      start: new Date('2025-01-16T14:00:00.000Z'),
      summary: '1:1 with Manager',
      uid: 'event-2@example.com',
    })
  })

  test('parses all-day events', () => {
    const events = parseICalEvents(allDayIcs)

    expect(events).toHaveLength(1)
    expect(events[0].uid).toBe('allday-1@example.com')
    expect(events[0].summary).toBe('Company Holiday')
    expect(events[0].start).toBeInstanceOf(Date)
    expect(events[0].end).toBeInstanceOf(Date)
  })

  test('returns empty array for ICS with no events', () => {
    const events = parseICalEvents(emptyIcs)
    expect(events).toHaveLength(0)
  })

  test('skips events without UID or summary', () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20250115T100000Z
DTEND:20250115T110000Z
UID:no-summary@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:20250115T100000Z
DTEND:20250115T110000Z
SUMMARY:No UID
END:VEVENT
END:VCALENDAR`

    const events = parseICalEvents(ics)
    // event without summary is skipped; event without UID is skipped
    expect(events).toHaveLength(0)
  })
})

describe('syncCalendar', () => {
  const user = 'testuser'
  const calendar = { name: 'Work', url: 'https://example.com/cal.ics' }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('stores events as tags and raw records', async () => {
    const fetchIcs = vi.fn().mockResolvedValue(sampleIcs)

    const result = await syncCalendar(user, calendar, { fetchIcs })

    expect(result.status).toBe('success')
    expect(result.eventsProcessed).toBe(2)
    expect(result.calendar).toBe('Work')

    // Should have called insertTag for each event
    expect(db.insertTag).toHaveBeenCalledTimes(2)
    expect(db.insertTag).toHaveBeenCalledWith(user, {
      endTime: new Date('2025-01-15T11:00:00.000Z'),
      externalId: 'event-1@example.com',
      source: 'calendar',
      startTime: new Date('2025-01-15T10:00:00.000Z'),
      tag: '[Work] Team Standup',
    })

    // Should have called insertRawRecord for each event
    expect(db.insertRawRecord).toHaveBeenCalledTimes(2)
    expect(db.insertRawRecord).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        externalId: 'event-1@example.com',
        recordType: 'calendar_event',
        source: 'calendar',
      }),
    )
  })

  test('updates sync state on success', async () => {
    const fetchIcs = vi.fn().mockResolvedValue(sampleIcs)

    await syncCalendar(user, calendar, { fetchIcs })

    expect(db.upsertSyncState).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        dataType: 'Work',
        provider: 'calendar',
        status: 'idle',
      }),
    )
  })

  test('returns error result on fetch failure', async () => {
    const fetchIcs = vi.fn().mockRejectedValue(new Error('Network error'))

    const result = await syncCalendar(user, calendar, { fetchIcs })

    expect(result.status).toBe('error')
    expect(result.error).toBe('Network error')
    expect(result.eventsProcessed).toBe(0)
  })

  test('handles empty calendar', async () => {
    const fetchIcs = vi.fn().mockResolvedValue(emptyIcs)

    const result = await syncCalendar(user, calendar, { fetchIcs })

    expect(result.status).toBe('success')
    expect(result.eventsProcessed).toBe(0)
  })
})

describe('syncAllCalendars', () => {
  const user = 'testuser'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('syncs all calendars from user settings', async () => {
    const fetchIcs = vi.fn().mockResolvedValue(sampleIcs)

    const calendars = [
      { name: 'Work', url: 'https://example.com/work.ics' },
      { name: 'Personal', url: 'https://example.com/personal.ics' },
    ]

    const results = await syncAllCalendars(user, calendars, { fetchIcs })

    expect(results).toHaveLength(2)
    expect(results[0].calendar).toBe('Work')
    expect(results[1].calendar).toBe('Personal')
    expect(fetchIcs).toHaveBeenCalledTimes(2)
  })

  test('returns empty array when no calendars configured', async () => {
    const results = await syncAllCalendars(user, [])
    expect(results).toHaveLength(0)
  })

  test('continues syncing other calendars when one fails', async () => {
    const fetchIcs = vi.fn().mockRejectedValueOnce(new Error('Failed')).mockResolvedValueOnce(sampleIcs)

    const calendars = [
      { name: 'Broken', url: 'https://example.com/broken.ics' },
      { name: 'Working', url: 'https://example.com/working.ics' },
    ]

    const results = await syncAllCalendars(user, calendars, { fetchIcs })

    expect(results).toHaveLength(2)
    expect(results[0].status).toBe('error')
    expect(results[1].status).toBe('success')
  })
})
