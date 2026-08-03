# Data Sources

Aurboda aggregates health, productivity, and location data from multiple sources. Each data source has its own setup requirements and sync mechanisms.

## Overview

<!-- BEGIN:data-sources -->

| Source                                            | Data Types                                                                                             | Sync Method                      | Admin Setup                  | User Setup                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------- | ---------------------------- | -------------------------------------------------------- |
| [**Android Health Connect**](./health-connect.md) | Heart rate, HRV, sleep, exercise (80+ types), steps, weight, SpO2, VO2 max, calories, and more         | Push from Android app            | None                         | Install Android app                                      |
| **BLE Sensors**                                   | Real-time heart rate, HRV (Polar H10, etc.) and steps (Zwift RunPod, etc.)                             | Live via Android app             | None                         | Pair sensor in Android app                               |
| [**Oura Ring**](./oura.md)                        | Sleep stages/scores, readiness, resilience, cardiovascular age, HRV, heart rate, meditation, tags      | Pull (API) + Push (webhooks)     | OAuth credentials (env vars) | OAuth connect                                            |
| [**Garmin Connect**](./garmin.md)                 | Daily summary, HR, HRV, sleep, stress, body battery, activities, SpO2, respiration, training readiness | Pull (session-based)             | None                         | Garmin credentials                                       |
| [**Strava**](./strava.md)                         | Activities with per-second heart rate, GPS routes, cadence, and power                                  | Pull (API) + Push (webhooks)     | OAuth credentials (admin)    | OAuth connect                                            |
| [**OwnTracks**](./owntracks.md)                   | GPS locations, geofences, place visits                                                                 | Push (HTTP mode)                 | None                         | OwnTracks app config                                     |
| [**RescueTime**](./rescuetime.md)                 | App/website usage, productivity scores, categories                                                     | Pull (API)                       | None                         | API key                                                  |
| [**ActivityWatch**](./activitywatch.md)           | App/window usage per device (desktop and Android)                                                      | Push (agent script)              | None                         | Install AW + push agent or enable in Aurboda Android app |
| [**Last.fm**](./lastfm.md)                        | Music scrobbles with auto-generated tags from configurable rules                                       | Pull (API)                       | API key (admin setting)      | Last.fm username                                         |
| [**Calendars (ICS)**](./calendars.md)             | Calendar events imported as tags (Google Calendar, Outlook, iCloud, Nextcloud, etc.)                   | Pull (ICS fetch)                 | None                         | ICS URL(s)                                               |
| **Cronometer**                                    | Meals with full per-item macros and ~50 micronutrients                                                 | CSV import                       | None                         | Export CSV from Cronometer                               |
| [**Livsmedelsverket**](./livsmedelsverket.md)     | Canonical food library: 2,500+ Swedish foods with macros + micros (per 100 g)                          | One-shot bulk import (UI button) | None                         | Click "Import from Livsmedelsverket" on /food-items      |
| **Manual Entry**                                  | Any metric, tag, activity, meal, or note                                                               | Web UI, REST API, or MCP         | None                         | —                                                        |

<!-- END:data-sources -->

## Sync Behavior

**Pull-based sources** (Oura, Strava, RescueTime, Last.fm, Calendars) support:

- **Manual sync** via REST API (`POST /api/sync/{provider}`) or MCP tool (`sync_{provider}`)
- **Auto-sync** triggered before queries if data is older than 30 minutes
- **Full resync** option to re-fetch historical data
- **Sync state tracking** per provider with rate limit handling

**Push-based sources** (ActivityWatch, Health Connect, OwnTracks) receive data from agents/apps:

- Data is sent by a local agent or app via `POST /api/sync/{provider}`
- ActivityWatch tracks last push time per device
- No auto-sync (agent controls the schedule)

Check sync status for all providers:

- REST: `GET /api/sync/status`
- MCP: `get_sync_status()`

## Data Storage

All sources feed into a common data model:

- **`time_series`** -- Timestamped metric values (HR, weight, steps, etc.)
- **`activities`** -- Duration-based events (sleep, exercise, meditation, nap)
- **`tags`** -- Labeled time points or spans (from Oura tags, Last.fm rules, calendar events)
- **`productivity`** -- App/website usage records (from RescueTime)
- **`locations`** -- GPS coordinates (from OwnTracks, plus activity tracks from Garmin and Strava)
- **`raw_records`** -- Original data preserved in full JSON form

See [data-storage.md](./data-storage.md) for the complete data model.

## GPS Precedence

Several sources write to `locations`: OwnTracks streams phone positions continuously, while [Garmin](./garmin.md) and [Strava](./strava.md) contribute a GPS track per activity. A watch or bike computer fixes position far more accurately than a phone in a pocket, and keeping both would interleave two tracks into one zig-zagging path.

So when an activity brings its own GPS track, locations from every other source are **soft-deleted for the activity's whole span** -- not merely the range the track covers, since the stored track is downsampled to 60-second intervals and its first and last fixes usually sit inside the activity. The number of points replaced is recorded in the audit log.

Points are only ever soft-deleted (`locations.deleted_at`), never removed, and re-inserting a source's own points revives them. If both Garmin and Strava hold a track for the same session, the source that synced most recently is the one shown, and re-syncing the other one switches it back.
