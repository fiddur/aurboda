# Calendars (ICS)

Aurboda can sync events from any calendar that provides an ICS URL. Events are stored as tags, enabling correlation analysis between scheduled activities and health metrics.

## Data Synced

Calendar events are stored as **tags** with:

- Tag text: event summary (title)
- Start time and end time from the event
- Source: `calendar`

This means calendar events appear on the timeline alongside other tags and can be used in trend analysis and correlations (e.g., "does my HRV drop on days with many meetings?").

## Admin Setup

No server-side configuration is needed on a public server.

The server fetches each ICS URL a user enters, so by default a URL may only lead to **public** addresses: a URL whose host resolves to a private, loopback or link-local address is refused, and so is a redirect to one. A server on a private network, whose users are trusted with that network, can lift this:

| Variable                           | Description                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `CALENDAR_ALLOW_PRIVATE_ADDRESSES` | `true` lets calendar URLs point at private / loopback addresses, e.g. a Nextcloud or Radicale on the same LAN (`http://nextcloud.lan/…`). |

Leave it unset on a server that is open to people you would not let onto your network.

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

1. Fetch ICS data from each configured URL (http or https, following up to 5 redirects, each checked like the URL itself)
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

## Troubleshooting

| Message                                         | Meaning                                                                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `The calendar address is private …`             | The URL, or a redirect from it, leads to a private or loopback address. Use a public URL, or ask the admin to set `CALENDAR_ALLOW_PRIVATE_ADDRESSES`. |
| `The calendar URL must use http or https`       | `webcal://` links are https links under another name: replace `webcal://` with `https://`.                                                            |
| `Failed to fetch ICS: 404 Not Found` (or other) | The calendar host answered with that status. Check the URL; a secret address may have been reset.                                                     |
| `Failed to fetch ICS (ECONNREFUSED)` (or other) | The host could not be reached from the Aurboda server.                                                                                                |
