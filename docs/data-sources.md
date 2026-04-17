# Data Sources

Aurboda aggregates health, productivity, and location data from multiple sources. Each data source has its own setup requirements and sync mechanisms.

## Overview

| Source                                | Data Types                                                                  | Sync Method                             | Admin Setup                  | User Setup                                               |
| ------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| [Oura Ring](./oura.md)                | Sleep, readiness, resilience, cardiovascular age, meditation, HRV, tags     | Pull (API) + Push (webhook)             | OAuth credentials (env vars) | OAuth connect                                            |
| [Garmin Connect](./garmin.md)         | Sleep, stress, body battery, HR, HRV, activities, SpO2, training readiness  | Pull (scrape)                           | None                         | Garmin credentials                                       |
| [Strava](./strava.md)                 | Activities with HR, GPS, cadence, power                                     | Pull (API queue) + Push (webhook)       | OAuth credentials (admin)    | OAuth connect                                            |
| [Health Connect](./health-connect.md) | HR, HRV, weight, body composition, steps, sleep, exercise, 40+ record types | Push (Android app)                      | None                         | Install Android app                                      |
| [ActivityWatch](./activitywatch.md)   | App/window usage, per-device tracking                                       | Push (agent script / Android companion) | None                         | Install AW + push agent or enable in Aurboda Android app |
| [RescueTime](./rescuetime.md)         | App/website usage, productivity scores                                      | Pull (API)                              | None                         | API key                                                  |
| [Last.fm](./lastfm.md)                | Music scrobbles, auto-generated tags                                        | Pull (API)                              | API key (admin setting)      | Last.fm username                                         |
| [Calendars](./calendars.md)           | Calendar events (stored as tags)                                            | Pull (ICS fetch)                        | None                         | ICS URL(s)                                               |
| [OwnTracks](./owntracks.md)           | GPS location, geofences                                                     | Push (HTTP)                             | None                         | OwnTracks app config                                     |
| Cronometer                            | Meals with full per-item macros and ~50 micronutrients                      | CSV import script                       | None                         | Export CSV from Cronometer                               |

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
- **`locations`** -- GPS coordinates (from OwnTracks)
- **`raw_records`** -- Original data preserved in full JSON form

See [data-storage.md](./data-storage.md) for the complete data model.
