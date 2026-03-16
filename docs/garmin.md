# Garmin Connect

[Garmin Connect](https://connect.garmin.com/) provides fitness and health data from Garmin wearable devices (watches, fitness trackers). Aurboda syncs data by scraping the Garmin Connect web API using the `@flow-js/garmin-connect` library, since Garmin's official API requires a partner license.

## Data Synced

| Garmin Data Type   | Stored As              | Metrics                                                                                                                  |
| ------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Daily Summary      | time_series            | `steps`, `distance`, `floors_climbed`, `calories_active`, `calories_total`, `resting_heart_rate`, `stress_level`, `spo2` |
| Heart Rate         | time_series            | `heart_rate` (individual samples from heartRateValues)                                                                   |
| HRV                | time_series            | `hrv_rmssd` (last night average)                                                                                         |
| Sleep              | activity + time_series | Sleep activity with stage durations; `sleep_score`, `resting_heart_rate`, `hrv_rmssd`, `heart_rate` (sleep HR samples)   |
| Stress             | time_series            | `stress_level` (overall daily stress)                                                                                    |
| Body Battery       | time_series            | `body_battery` (from values array or daily charged amount)                                                               |
| Activities         | activity + time_series | Exercise activities with type, distance, calories, HR, VO2 max; `vo2_max`                                                |
| SpO2               | time_series            | `spo2` (average daily blood oxygen)                                                                                      |
| Respiration        | time_series            | `respiratory_rate` (average waking respiration)                                                                          |
| Training Readiness | time_series            | `training_readiness` (overall score)                                                                                     |
| Intensity Minutes  | time_series            | `intensity_minutes` (moderate + vigorous×2)                                                                              |

All data is also preserved as raw JSON in the `raw_records` table.

## Admin Setup

No server-side admin configuration is needed. Unlike Oura (which requires OAuth client credentials), Garmin Connect integration uses per-user credentials to authenticate directly with Garmin's web services.

## User Setup

1. Go to **Settings > Data Sources > Garmin Connect**
2. Enter your Garmin Connect **email** and **password**
3. Click **Connect**
4. If successful, Settings will show "Connected"

**Important:** Your Garmin credentials are used only for the initial authentication and are **never stored** on the server. Only the resulting OAuth session tokens are persisted, which allow continued access without re-entering credentials.

If Garmin requires MFA (multi-factor authentication), you'll be prompted accordingly.

## Sync

Manually trigger a sync to fetch the latest data:

- **REST:** `POST /api/sync/garmin`
- **MCP:** `sync_garmin()`

Options:

- `full_resync: true` -- Re-fetch all historical data (default: last 90 days)
- `start_date: "YYYY-MM-DD"` -- Start date for full resync

The sync fetches all 11 data types sequentially. Each data type's API is queried day by day (unlike Oura which supports date-range queries). A 100ms delay is added between day-fetches to avoid rate limiting.

Each data type tracks its own sync state, so incremental syncs only fetch new data since the last sync (with a 2-day overlap to catch retroactive edits).

Rate limiting (HTTP 429 or similar errors) is handled automatically with exponential backoff (1, 5, 15, 60 minutes). If one data type hits a rate limit, remaining data types are skipped for that sync cycle.

## Auto-Sync

Garmin data is automatically synced before queries if the last sync was more than 30 minutes ago (same threshold as other pull-based sources).

## Disconnecting

To disconnect Garmin:

- **REST:** `POST /api/auth/garmin/disconnect`
- **Settings:** Click "Disconnect" in the Garmin section

This removes the stored session tokens. You'll need to re-enter your credentials to reconnect.

## Limitations

- **No webhook/push support:** Garmin's official webhook API requires a partner license. Sync is pull-based only.
- **Session expiry:** Garmin Connect sessions may expire, requiring the user to re-authenticate by entering credentials again.
- **MFA:** If Garmin MFA is enabled, the current implementation may not fully support the MFA flow.
- **Rate limiting:** Garmin's unofficial API has undocumented rate limits. The day-by-day iteration with delays helps, but full resyncs of 90+ days may encounter limits.
