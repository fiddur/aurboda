# Home Assistant

[Home Assistant](https://www.home-assistant.io/) (HA) knows where your phone is when the HA companion app reports its position: the phone shows up as a `device_tracker.*` entity, and as part of your `person.*` entity. Aurboda **pulls** that position history from HA's REST API with a long-lived access token and stores it as GPS locations, the same table [OwnTracks](./owntracks.md) writes to. The zone HA puts you in (home, work, …) becomes a place visit.

Nothing has to be configured in Home Assistant beyond the companion app: no automation, no webhook. Aurboda asks HA; HA never calls Aurboda.

## Data Synced

Every recorded state of the chosen entity that carries coordinates becomes one row in `locations` with `source = 'home_assistant'`:

| Home Assistant                     | `locations` column | Notes                                                                                  |
| ---------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| `last_updated`                     | `time`             | When HA recorded the state (also when only an attribute changed)                       |
| `attributes.latitude`, `longitude` | `location`         | States without finite, in-range coordinates are skipped                                |
| `attributes.gps_accuracy`          | `accuracy`         | Metres                                                                                 |
| `attributes.altitude`              | `altitude`         | Metres; the companion app's `device_tracker` reports it, `person` does not             |
| `attributes.speed`                 | `velocity`         | HA reports m/s; stored as km/h, the unit OwnTracks writes                              |
| `state` (the zone)                 | `regions`          | `home` → `["Home"]`; `not_home`, `unknown`, `unavailable` → none; else the zone's name |

A row whose region is set becomes a place visit named after the zone, with place source `home_assistant` — unless a [named or detected location](./features/places.md) covers the point, which always wins. A zone named like one of your named locations counts as that named location in the [places summary](./features/places.md#places-summary).

Home Assistant zones themselves are not imported as named locations, and no other entities are read.

## Admin Setup

None by default. Aurboda only talks to a Home Assistant that is reachable over **https** at a **public** address: the URL a user enters is checked before every request, private, loopback and link-local targets are refused, and redirects are not followed. This keeps a user from pointing the server at its own internal network.

A self-hosted Aurboda that sits on the same LAN as Home Assistant can lift both restrictions:

| Environment variable                     | Effect                                                                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOME_ASSISTANT_ALLOW_PRIVATE_ADDRESSES` | `true` allows private / loopback addresses and plain `http` (the scheme must still be http or https). Only for a server whose users you trust with your network. |

See [Docker → Environment variables](./docker.md).

## User Setup

Go to **Data Sources → Home Assistant**.

1. **Create a dedicated Home Assistant user for Aurboda (recommended).** HA long-lived access tokens are not scoped: a token can do everything its user can. A separate, **non-admin** user limits what a leaked token could do. In HA: **Settings → People → Users → Add user**, without administrator rights.
2. **Create a long-lived access token** as that user: profile (bottom left) → **Security** → **Long-lived access tokens** → **Create token**. Copy it; HA shows it once.
3. **Enter the URL** of your Home Assistant as it is reachable **from the Aurboda server**, e.g. `https://ha.example.org` or a Nabu Casa remote URL. `http://homeassistant.local:8123` only works when the admin has set `HOME_ASSISTANT_ALLOW_PRIVATE_ADDRESSES`.
4. **Paste the token.** It is write-only: Aurboda never shows it again, and the settings only say whether one is stored. Changing the URL to another host (origin) removes the stored token unless you enter a new one in the same change, so a hijacked Aurboda session cannot send your token elsewhere.
5. **Pick the entity.** The list shows the `person.*` and `device_tracker.*` entities that currently have coordinates (`GET /api/home-assistant/entities`, MCP `list_home_assistant_entities`). Loading it is also the connection test.
   - The phone's **`device_tracker.*`** (from the companion app) carries altitude and speed, and is the better choice for a single phone.
   - **`person.*`** merges several trackers (phone, router presence, …) into one position, but reports only latitude, longitude and accuracy.

Then **Sync now**, or wait for the background poll.

Settings via the API: `PATCH /api/user/settings` with `home_assistant_url`, `home_assistant_token` and `home_assistant_entity_id` (each `null` to clear). The response carries `home_assistant_url`, `home_assistant_entity_id` and `home_assistant_token_set`, never the token.

## How Sync Works

- **REST:** `POST /api/sync/home-assistant` — `{ "full_resync": true, "start_date": "YYYY-MM-DD" }` optional. The result counts `locations_fetched` (states with coordinates HA returned), `locations_inserted` (rows that were new) and `locations_superseded` (new rows soft-deleted because an activity's own GPS track covers them).
- **MCP:** `sync_home_assistant()`
- **Status:** `GET /api/sync/home-assistant/status`, `get_sync_status(provider: "home_assistant")`
- **Reset:** `DELETE /api/sync/home-assistant/state`, `reset_sync_state(provider: "home_assistant")`

A run reads HA's history API, one request per 24 hours of the window:

```
GET <url>/api/history/period/<start>?filter_entity_id=<entity>&end_time=<end>&significant_changes_only=0&skip_initial_state
```

- `significant_changes_only=0` is needed because otherwise HA reports a `person.*` entity only when its state string changes, so a move that stays `not_home` would be lost.
- `skip_initial_state` is needed because otherwise HA prepends the state as of `<start>` with its time rewritten to `<start>`, which would invent a position at every sync start.

**Window.** The first sync (or a full resync) reaches back **10 days**, HA's default recorder retention, or to `start_date`. Later syncs start **5 minutes before the last successful sync**: HA commits states to its database with a delay, and the overlap picks up rows that were not visible yet. Rows already stored are skipped (`ON CONFLICT (source, time) DO NOTHING`). The last sync time only advances when every request of the run succeeded; on an error the next run re-covers the same window.

**Background polling.** The background scheduler polls Home Assistant every **10 minutes** by default. Set `sync_intervals.home_assistant` (or `sync_intervals.default`) in minutes to change it, on the Data Sources page or via the settings API. See [Data Sources → Sync Behavior](./data-sources.md#sync-behavior). After a failed sync (Home Assistant down or unreachable, a rejected token) the background poll waits 15 minutes before it tries again; a manual sync runs at once.

**After a sync that stored new rows**, stay detection and [deduction rules](./features/deduction-rules.md) run over the synced window, as they do after an OwnTracks push.

### GPS precedence

Home Assistant positions are passive phone positions, like OwnTracks: where an activity has its own GPS track (Garmin, Strava), that track wins for the activity's span. Because a pull arrives after the fact, possibly after the activity's track was written, each sync also soft-deletes the `home_assistant` points in its window that fall inside an activity that has a track in `activity_tracks`. See [GPS Precedence](./data-sources.md#gps-precedence).

## Limitations

- Home Assistant must be reachable from the Aurboda server (see [Admin Setup](#admin-setup)).
- The backfill is bounded by the recorder's `purge_keep_days` (10 days by default); a full resync cannot fetch what HA has already purged.
- HA only records a state when the state or an attribute changes, so a phone at rest yields few rows. Place views carry the last known position forward where they support it.
- Polling lags reality by up to the poll interval.

## Troubleshooting

The last error is shown in the sync status bar on the Home Assistant page and returned by the status endpoint.

| Message                                                   | What to do                                                                                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Home Assistant rejected the access token`                | HA answered 401/403. Create a new long-lived token and paste it.                                                                        |
| `Home Assistant answered 404: check the URL`              | The URL reaches a server, but not HA's API. Use the base URL without `/api`.                                                            |
| `Home Assistant answered 3xx (a redirect): check the URL` | Redirects are not followed. Enter the final URL (often `https://` instead of `http://`).                                                |
| `Could not reach Home Assistant (<code>)`                 | No answer: wrong host or port, HA down, or a firewall between the servers.                                                              |
| `The Home Assistant address is private …`                 | The host resolves to a private or loopback address. Use a public URL, or ask the admin to set `HOME_ASSISTANT_ALLOW_PRIVATE_ADDRESSES`. |
| `The Home Assistant URL must use https`                   | Use an https URL, or ask the admin to set `HOME_ASSISTANT_ALLOW_PRIVATE_ADDRESSES`.                                                     |
| `Home Assistant is not configured`                        | Set the URL, the token and the entity.                                                                                                  |
