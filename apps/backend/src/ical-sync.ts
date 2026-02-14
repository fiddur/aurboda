/**
 * ICS calendar sync module.
 *
 * Parses ICS calendar data and stores events as tags + raw records.
 * Follows the same patterns as oura-sync and rescuetime-sync.
 */

import type { CalendarSyncResult } from '@aurboda/api-spec'
import ical from 'node-ical'
import { insertRawRecord, insertTag, upsertSyncState } from './db'

export interface CalendarEvent {
  uid: string
  summary: string
  start: Date
  end: Date | undefined
  description: string | undefined
  location: string | undefined
}

export interface CalendarConfig {
  name: string
  url: string
}

export interface SyncCalendarOptions {
  fetchIcs?: (url: string) => Promise<string>
}

const defaultFetchIcs = async (url: string): Promise<string> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ICS: ${response.status} ${response.statusText}`)
  }
  return response.text()
}

/**
 * Parse VEVENT entries from ICS text into CalendarEvent objects.
 */
export const parseICalEvents = (icsText: string): CalendarEvent[] => {
  const parsed = ical.sync.parseICS(icsText)
  const events: CalendarEvent[] = []

  for (const key of Object.keys(parsed)) {
    const component = parsed[key]
    if (!component || component.type !== 'VEVENT') continue

    const vevent = component as ical.VEvent
    if (!vevent.uid || !vevent.summary) continue

    const start = vevent.start instanceof Date ? vevent.start : new Date(String(vevent.start))
    const end =
      vevent.end ?
        vevent.end instanceof Date ?
          vevent.end
        : new Date(String(vevent.end))
      : undefined

    events.push({
      description: typeof vevent.description === 'string' ? vevent.description : undefined,
      end,
      location: typeof vevent.location === 'string' ? vevent.location : undefined,
      start,
      summary: String(vevent.summary),
      uid: String(vevent.uid),
    })
  }

  return events
}

/**
 * Sync a single calendar: fetch ICS, parse events, store as tags + raw records.
 */
export const syncCalendar = async (
  user: string,
  calendar: CalendarConfig,
  options?: SyncCalendarOptions,
): Promise<CalendarSyncResult> => {
  const fetchIcs = options?.fetchIcs ?? defaultFetchIcs

  try {
    const icsText = await fetchIcs(calendar.url)
    const events = parseICalEvents(icsText)

    for (const event of events) {
      await insertTag(user, {
        end_time: event.end,
        external_id: event.uid,
        source: 'calendar',
        start_time: event.start,
        tag: `[${calendar.name}] ${event.summary}`,
      })

      await insertRawRecord(user, {
        data: {
          calendarName: calendar.name,
          description: event.description,
          location: event.location,
          summary: event.summary,
        },
        external_id: event.uid,
        record_type: 'calendar_event',
        recorded_at: event.start,
        source: 'calendar',
      })
    }

    await upsertSyncState(user, {
      data_type: calendar.name,
      last_sync_time: new Date(),
      provider: 'calendar',
      status: 'idle',
    })

    return {
      calendar: calendar.name,
      events_processed: events.length,
      status: 'success',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    await upsertSyncState(user, {
      data_type: calendar.name,
      error_message: message,
      provider: 'calendar',
      status: 'error',
    }).catch(() => {}) // Don't fail on sync state update error

    return {
      calendar: calendar.name,
      error: message,
      events_processed: 0,
      status: 'error',
    }
  }
}

/**
 * Sync all configured calendars for a user.
 */
export const syncAllCalendars = async (
  user: string,
  calendars: CalendarConfig[],
  options?: SyncCalendarOptions,
): Promise<CalendarSyncResult[]> => {
  const results: CalendarSyncResult[] = []

  for (const calendar of calendars) {
    const result = await syncCalendar(user, calendar, options)
    results.push(result)
  }

  return results
}
