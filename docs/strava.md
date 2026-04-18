# Strava

[Strava](https://www.strava.com/) tracks running, cycling, swimming, and many other activities. Aurboda syncs your full activity history including per-second heart rate, GPS routes, and detailed metrics. New activities are synced automatically via webhooks.

## Data Synced

| Strava Data | Stored As   | Details                                                                       |
| ----------- | ----------- | ----------------------------------------------------------------------------- |
| Activities  | activity    | Type, distance, duration, calories, elevation, average/max HR                 |
| Heart Rate  | time_series | Per-second `heart_rate` from activity streams                                 |
| Cadence     | time_series | Per-second `cadence` from activity streams                                    |
| Power       | time_series | Per-second `power` (watts) from activity streams                              |
| Altitude    | time_series | Per-second `altitude` from activity streams                                   |
| GPS Routes  | locations   | Latitude/longitude from activity streams (downsampled to 60-second intervals) |

All data is also preserved as raw JSON in the `raw_records` table.

### Activity Type Mapping

Strava's ~30 sport types (Run, TrailRun, Ride, MountainBikeRide, Swim, Walk, Hike, Yoga, WeightTraining, etc.) are automatically mapped to Aurboda activity types. Unknown sport types are auto-created as new activity types.

## Admin Setup

The server administrator must register a Strava API application:

1. Go to [Strava API Settings](https://www.strava.com/settings/api)
2. Create an application to get a Client ID and Client Secret
3. Set the **Authorization Callback Domain** to your server domain (e.g., `aurboda.net`)

Then configure the server settings via the Admin API:

| Server Setting         | Description                     |
| ---------------------- | ------------------------------- |
| `strava_client_id`     | OAuth client ID from Strava     |
| `strava_client_secret` | OAuth client secret from Strava |

These are stored as server settings in the central database (set via admin settings page).

**Note:** Strava also shows an access_token and refresh_token when you register the app -- these are your personal tokens as the app owner and are **not needed** for server configuration. Each user gets their own tokens through the OAuth flow.

The OAuth callback URL is: `{API_BASE_URL}/auth/stravacb` (e.g., `https://aurboda.net/api/auth/stravacb`)

If these are not set, the "Connect Strava" button will be disabled with a message asking the admin to configure them.

## User Setup

1. Go to **Data Sources > Strava**
2. Click **Connect Strava**
3. Authorize Aurboda on the Strava website
4. You'll be redirected back. The page will show "Connected" when successful.

This uses a standard OAuth 2.0 authorization code flow. Access tokens (6-hour expiry) are automatically refreshed using the stored refresh token.

## Sync

Manually trigger a sync:

- **REST:** `POST /api/sync/strava` (returns 202 -- fire-and-forget)
- **MCP:** `sync_strava()`

Options:

- `full_resync: true` -- Re-fetch all historical activities

### How Sync Works

Sync uses a **fire-and-forget** pattern (like Garmin):

1. A sync request enqueues jobs into the pg-boss `strava-sync` queue
2. The API responds immediately with 202
3. Jobs are processed in the background, one at a time

For each sync:

1. A `list_activities` job fetches the activity list from Strava
2. For each activity, a `fetch_activity` job is enqueued to get detailed data + streams
3. Each `fetch_activity` makes 2 API calls: activity detail and activity streams

### Rate Limiting

Strava rate limits are **per-application** (shared across all users):

- **100 reads per 15 minutes** (short-term window)
- **1,000 reads per day** (long-term window)

The queue handles this with:

- **Single-threaded processing** (`batchSize: 1`) -- one API call at a time across all users
- **Adaptive delay** between jobs based on remaining budget from `X-ReadRateLimit-Usage` headers
- **429 handling** -- on rate limit exceeded, retries with exponential backoff
- **Priority scheduling** -- webhook events (priority 1) are processed before incremental sync (priority 5) and historical backfill (priority 10)

With 2 API calls per activity, a full day's budget processes ~500 activities.

## Webhooks

Strava webhooks provide near-real-time notifications when activities are created, updated, or deleted.

### How It Works

1. On server startup, the webhook subscription is automatically created/verified
2. Strava sends a POST to `{WEB_HOST}/webhooks/strava` when an activity changes
3. The server responds within 2 seconds (Strava requirement) and processes asynchronously
4. Activity creates/updates enqueue a high-priority fetch job
5. Activity deletes soft-delete the activity and related data
6. Athlete deauthorizations clean up tokens and mappings

### Requirements

- `WEB_HOST` must be publicly accessible
- `strava_client_id` and `strava_client_secret` must be configured
- A verify token is auto-generated for webhook validation

## Disconnecting

To disconnect Strava:

- **Settings:** Click "Disconnect" in the Strava data source page
- **REST:** `POST /api/auth/strava/disconnect`

This removes OAuth tokens and the athlete mapping. Webhook events for the disconnected user will be ignored.

## Limitations

- **Shared rate limits:** All users share the same API budget. Large historical backfills from multiple users may take days to complete.
- **Stream availability:** Not all activities have stream data (HR, GPS). Older or manually-entered activities may lack streams.
- **GPS downsampling:** GPS coordinates are stored at 60-second intervals to manage storage, not at full per-second resolution.
