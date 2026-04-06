# Calendars (ICS)

Aurboda can sync events from any calendar that provides an ICS URL. Events are stored as tags, enabling correlation analysis between scheduled activities and health metrics.

## Data Synced

Calendar events are stored as **tags** with:

- Tag text: event summary (title)
- Start time and end time from the event
- Source: `calendar`

This means calendar events appear on the timeline alongside other tags and can be used in trend analysis and correlations (e.g., "does my HRV drop on days with many meetings?").

## Admin Setup

No server-side configuration is needed.

## User Setup

1. Go to **Settings > Data Sources > Calendars**
2. Add one or more calendars by providing:
   - **Name** -- A display name for the calendar
   - **ICS URL** -- The calendar's ICS feed URL

### Finding Your ICS URL

Most calendar providers offer ICS export URLs:

- **Google Calendar:** Calendar Settings > "Secret address in iCal format"
- **Outlook/Office 365:** Calendar Settings > Shared calendars > Publish a calendar
- **Apple iCloud:** Calendar sharing > Public Calendar link
- **Nextcloud:** Calendar > sharing icon > copy link with `.ics` extension

## Sync

### Manual Sync

- **REST:** `POST /api/sync/calendars`
- **MCP:** `sync_calendars()`

Options:

- `full_resync: true` -- Re-fetch and reprocess all events

### Auto-Sync

Calendar data is automatically refreshed before tag-related queries if the last sync was more than 30 minutes ago.

### Sync Process

1. Fetch ICS data from each configured URL
2. Parse events from the ICS feed
3. Store events as tags with the calendar source
4. Each calendar tracks its own sync state independently

Results show events processed per calendar:

```json
{
  "results": [
    { "calendar": "Work", "status": "success", "events_processed": 42 },
    { "calendar": "Personal", "status": "success", "events_processed": 15 }
  ]
}
```
