# Garmin Connect

[Garmin Connect](https://connect.garmin.com/) provides fitness and health data from Garmin wearable devices (watches, fitness trackers). Aurboda reaches it in two ways, alone or together:

- **The Garmin Connect login** ("the session"): the Garmin Connect web API, reached with [`@fiddur/garmin-connect`](https://www.npmjs.com/package/@fiddur/garmin-connect), our [fork](https://github.com/fiddur/garmin-connect) of `@flow-js/garmin-connect` with two-step MFA login.
- **A Personal API key**: Garmin's official [Personal API](https://developer.garmin.com/gc-developer-program/overview/) at `personal.connectapi.garmin.com`, which any Garmin Connect user can create a key for. It is pull only, like the session, and covers most but not all of what the session does.

Garmin's partner (business) API, with push notifications, is not used.

## Two ways to connect

Each data type is fetched through one connection:

| Data type          | Login only | Key only                | Both                              |
| ------------------ | ---------- | ----------------------- | --------------------------------- |
| Daily summary      | Login      | Key                     | Key                               |
| Heart rate         | Login      | Key                     | Key                               |
| HRV                | Login      | Key                     | Key                               |
| Sleep              | Login      | Key (no stage timeline) | Login (it has the stage timeline) |
| Body Battery       | Login      | Key                     | Key                               |
| SpO2               | Login      | Key                     | Key                               |
| Respiration        | Login      | Key (from the summary)  | Key                               |
| Intensity minutes  | Login      | Key (from the summary)  | Key                               |
| Activities         | Login      | Key                     | Key                               |
| Activity details   | Login      | Skipped                 | Login                             |
| Stress             | Login      | Skipped                 | Login                             |
| Training readiness | Login      | Skipped                 | Login                             |

With a key and no login, stress and training readiness are skipped (no sync state is written for them), sleep comes without the stage timeline (a Health Connect timeline already on the night is kept), and activities come without the per-second detail and GPS track. A key Garmin refused stops being used until it is replaced; the session, if any, then serves every type again.

Respiration and intensity minutes come from the key's daily summary (`avgWakingRespirationValue`, `moderateIntensityMinutes`, `vigorousIntensityMinutes`, `intensityMinutesGoal`), which is fetched once per day for all three types.

## Data Synced

| Garmin Data Type   | Stored As              | Metrics                                                                                                                  |
| ------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Daily Summary      | time_series            | `steps`, `distance`, `floors_climbed`, `calories_active`, `calories_total`, `resting_heart_rate`, `stress_level`, `spo2` |
| Heart Rate         | time_series            | `heart_rate` (individual samples from heartRateValues)                                                                   |
| HRV                | time_series            | `hrv_rmssd` (last night average)                                                                                         |
| Sleep              | activity + time_series | Sleep activity with stages and durations; `sleep_score`, `resting_heart_rate`, `hrv_rmssd`, `heart_rate` (sleep HR)      |
| Stress             | time_series            | `stress_level` (overall daily stress)                                                                                    |
| Body Battery       | time_series            | `body_battery` (from values array or daily charged amount)                                                               |
| Activities         | activity + time_series | Exercise activities with type, distance, calories, HR, VO2 max; `vo2_max`                                                |
| Activity Details   | time_series            | Per-second `stress_level`, `heart_rate`, `respiratory_rate`, `body_battery` from activity detail API                     |
| SpO2               | time_series            | `spo2` (average daily blood oxygen)                                                                                      |
| Respiration        | time_series            | `respiratory_rate` (average waking respiration)                                                                          |
| Training Readiness | time_series            | `training_readiness` (overall score)                                                                                     |
| Intensity Minutes  | time_series            | `intensity_minutes` (moderate + vigorous×2)                                                                              |

All data is also preserved as raw JSON in the `raw_records` table.

> **Note on `calories_active` and `calories_total`:** these metrics are stored from Garmin's daily summary (source `garmin`) but **excluded from queries** — aurboda recomputes them per-minute from HR data using the zone-METs model and is the authoritative source for both metrics. See [`docs/features/calories.md`](./features/calories.md) for the model and the source-filter rationale.

## Activity Type Mapping

Garmin labels each activity with a `typeKey` (e.g. `running`, `indoor_rowing`, `rowing_v2`). It is resolved to an aurboda activity type in this order:

1. **Override map** — Garmin names that differ from the Health Connect exercise names used in `@aurboda/api-spec` (e.g. `treadmill_running` → `running_treadmill`, `indoor_rowing` → `rowing_machine`, `breathwork` → `meditation`). Aligning the names keeps cross-source merging working.
2. **Version suffix stripped** — Garmin revises sport keys in place and marks them with a version suffix, so `rowing_v2` resolves as `rowing` and `indoor_rowing_v2` goes through the override map as `indoor_rowing`.
3. **Fallback** — if the resulting name has no row in `activity_type_definitions`, the activity is stored as `other_workout` with the original key kept in `data.garmin_type_key`. Without this, an unrecognized sport would violate the `activities.activity_type` foreign key and abort the rest of the batch.

A custom activity profile made on the watch (a copy of a built-in profile with a new name) is reported by Garmin as its base sport — a copy of "Other" arrives as `other`, stored as `other_workout`. The profile name only survives in the title, which Garmin prefixes with the place for GPS activities ("Mark Sex"). A [retype deduction rule](./features/deduction-rules.md#retype-mode) matching on the title turns these into the aurboda type you want.

A degraded type is recorded in the audit log as a warning (once per distinct key per sync), so new Garmin sports surface there rather than only in `data.garmin_type_key`. A failure on one activity is logged as an error and does not stop the remaining activities in the batch.

## GPS

Activity GPS comes from the activity detail API, every sample kept (`geoPolylineDTO` is the fallback when the per-second metrics carry no coordinates). It supersedes coarser tracking from other sources (e.g. OwnTracks phone positions) for the activity's whole span -- see [GPS Precedence](./data-sources.md#gps-precedence).

The same samples, with `directElevation` as altitude, are also written as the activity's track in `activity_tracks` -- see [Routes and segments](./features/routes-and-segments.md). Activities synced before tracks existed get theirs from the stored detail by the track backfill.

## Admin Setup

No server-side configuration is needed: both ways use per-user credentials. Admins can stop new Personal API key connections with **Garmin Personal API keys** on the Admin Settings page (`garmin_personal_key_enabled`, on by default) — see [Server administration](./admin.md#garmin-personal-api-keys). Garmin's terms restrict a Personal API key to tools its owner operates for their own use; on a shared server a user who connects a key shares it with the server's operator, which the key form says.

## User Setup

### Garmin Connect login

1. Go to **Data Sources > Garmin**
2. Enter your Garmin Connect **email** and **password**
3. Click **Connect**
4. If your account has MFA (multi-factor authentication) enabled, Garmin will send a verification code to your email. Enter the code in the form that appears and click **Verify Code**.
5. If successful, Settings will show "Connected"

**Important:** Your Garmin credentials are used only for the initial authentication and are **never stored** on the server. Only the resulting OAuth session tokens are persisted, which allow continued access without re-entering credentials.

### Personal API key

1. In Garmin Connect, create a key under **Settings > Personal API token** (`https://connect.garmin.com/app/settings/personalApiToken`). Garmin lets you choose its lifetime, a year at most, and does not report it back, so note the date.
2. Go to **Data Sources > Garmin**, paste the key under **Personal API key**, and set when it expires (30 days, 90 days, 180 days, 1 year, or any date).
3. Click **Connect key**. Aurboda exchanges the key with Garmin once; a key Garmin refuses is not stored.

REST: `POST /api/auth/garmin/personal-key` with `{ "api_key": "...", "expires_at": "YYYY-MM-DD" }` answers `200`, `400` (a missing key or a past date), `401` ("Garmin refused the key"), `403` (turned off by the admin) or `502` (another Garmin failure). There is no MCP tool for it, as for the other credential flows.

The key is stored in the user's own database (`oauth_tokens`, provider `garmin_personal`: the key in `refresh_token`, the expiry date entered in `expires_at`). It never appears in an API response, an audit entry or a log line. Each sync exchanges the key for a JWT that lasts 24 hours; the JWT is cached and replaced when less than an hour of it is left, or when Garmin answers `401`. When Garmin refuses the key itself (`401`/`403` on the exchange) the key is marked refused (`oauth_tokens.refused_at`), nothing more is sent to Garmin with it, and the Garmin page asks for a new one.

The page shows when the key expires, as a warning from 14 days before and as an error once past or refused; **Replace key** stores a new one. Settings report the state as `garmin_personal_key` (`available`, `connected`, `expires_at`, `refused`), next to `garmin_session_connected`; `garmin_connected` is true for either.

#### Expiry reminders

Garmin does not report a key's expiry, so the reminders go by the date entered with it. Through the [central notifications](./features/notifications.md) (type `garmin_key_expiring`, **Garmin key renewal** under **Data sources** in the notification settings, where its in-app and push switches turn it off) the owner is told when 14 days are left, again at 3 days, once the date has passed, and once if Garmin refuses the key before then. Each opens the Garmin page. The five-minute background sync tick checks every user's key (`apps/backend/src/integrations/garmin/key-reminder.ts`); each reminder is stored once per expiry date, so a new key with a new date gets its own. Connecting a new key or disconnecting the key marks the earlier reminders read. No reminder carries the key.

## Sync

Manually trigger a sync to fetch the latest data:

- **REST:** `POST /api/sync/garmin`
- **MCP:** `sync_garmin()`

Options:

- `full_resync: true` -- Re-fetch all historical data (default: last 90 days)
- `start_date: "YYYY-MM-DD"` -- Start date for full resync

The sync fetches all 11 data types sequentially, each through the connection the table above picks; a type no connection serves is reported as `skipped`. Each data type's API is queried day by day (unlike Oura which supports date-range queries). A 100ms delay is added between day-fetches to avoid rate limiting.

Each data type tracks its own sync state, so incremental syncs only fetch new data since the last sync (with a 2-day overlap to catch retroactive edits).

Activities are keyed by `external_id = garmin-activity-<activityId>` and sleep by `garmin-sleep-<calendarDate>` — the same identity the Health Connect processor derives for sessions the Garmin Connect app writes, so both paths share one row (see [Health Connect → Source identity](./health-connect.md#source-identity)). Rows from before external ids existed are claimed on the next sync that touches them rather than duplicated. A type-mapping change still replaces such legacy rows; keyed rows are updated in place so an enriched Health Connect session and its notes survive.

The sleep row's `data.stages` holds the stage timeline in the Health Connect shape (`{ startTime, endTime, stage }`, stages `1` awake, `4` light, `5` deep, `6` REM), mapped from Garmin's `sleepLevels` (`activityLevel` 0 deep, 1 light, 2 REM, 3 awake). A night without levels leaves the key out so a Health Connect timeline already on the row is kept.

Rate limiting (HTTP 429 or similar errors) is handled automatically with exponential backoff (1, 5, 15, 60 minutes). If one data type hits a rate limit, remaining data types are skipped for that sync cycle.

## Auto-Sync

Garmin is polled by the background scheduler and topped up before queries, both governed by the user's `sync_intervals` setting (`garmin`, else `default`; server fallback 30 minutes) — see [Data Sources → Sync Behavior](./data-sources.md#sync-behavior). Every data type keeps its own sync state, so each is checked against the interval separately. A user who has connected Garmin in neither way is skipped before anything is read or written: no audit entry, no sync state, no request to Garmin. A manual sync for such a user returns an error per data type instead of attempting the fetch.

When the Android app delivers a Health Connect exercise or sleep session written by the Garmin Connect app, an enrichment job runs the Garmin `activities` (plus activity detail) or `sleep` sync for that user within about a minute, so the session gets its Garmin data without waiting for the poll. Garmin often lists a fresh activity before it serves the activity's detail; while the stored row is still without detail (`data.detail_synced`), the activity job fails and is retried with backoff (3 retries, from 2 minutes) instead of reporting success. A user with a key and no login has no source for the detail, so the job does not wait for it.

When an activity's detail lands for the first time (the poll, a manual sync, the enrichment job) or is re-synced by hand, any feed post sharing it is re-federated as an `Update`, so followers get the settled distance, heart-rate chart and route map — see [Feed](./features/feed.md#publishing--lifecycle-delivery). Auto-share rules wait for the detail before sharing a Garmin-backed activity, for up to two hours — see [Auto-share rules](./features/auto-share-rules.md#evaluation--timing).

## Disconnecting

The two connections are disconnected separately:

- **Login:** `POST /api/auth/garmin/disconnect`, or **Disconnect** under the login on the Garmin page. This removes the stored session tokens; you'll need to re-enter your credentials to reconnect.
- **Key:** `POST /api/auth/garmin/personal-key/disconnect`, or **Disconnect key** on the Garmin page. This deletes the stored key. Revoke it in Garmin Connect too if you no longer use it.

## Limitations

- **No webhook/push support:** Garmin's push API is part of its partner program. Both ways are pull-based only.
- **Session expiry:** Garmin Connect sessions may expire, requiring the user to re-authenticate by entering credentials again.
- **Key expiry:** a Personal API key lasts at most a year and must then be replaced by hand; [reminders](#expiry-reminders) come before the entered date.
- **MFA timeout:** The MFA verification code must be entered within 5 minutes of submitting credentials. If the session expires, start the login flow again.
- **Rate limiting:** neither the web API nor the Personal API publishes its rate limits. The day-by-day iteration with delays helps, but full resyncs of 90+ days may encounter limits.
