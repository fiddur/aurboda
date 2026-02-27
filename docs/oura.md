# Oura Ring

[Oura Ring](https://ouraring.com/) provides sleep tracking, readiness scores, HRV, and more. Aurboda supports both pull-based sync (on-demand API calls) and push-based sync (near-real-time webhooks).

## Data Synced

| Oura Data Type           | Stored As              | Details                                                                                                                                                                                                         |
| ------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily Sleep              | time_series            | `sleep_score`, `sleep_deep_score`, `sleep_efficiency`, `sleep_latency`, `sleep_rem_score`, `sleep_restfulness`, `sleep_timing`, `sleep_total_score`                                                             |
| Daily Readiness          | time_series            | `readiness_score`                                                                                                                                                                                               |
| Daily Resilience         | time_series            | `resilience_score` (mapped: exceptional=100, strong=75, solid=50, limited=25)                                                                                                                                   |
| Daily Cardiovascular Age | time_series            | `cardiovascular_age`                                                                                                                                                                                            |
| Sleep Periods            | activity + time_series | Individual sleep periods: `long_sleep` stored as `sleep`, short sleep as `nap`, rest as `meditation`. Sleep phases converted to Health Connect stage format. HR and HRV interval data extracted as time series. |
| Sessions (meditation)    | activity + time_series | Activities with type `meditation`; HR and HRV interval data extracted as time series                                                                                                                            |
| Enhanced Tags            | tags                   | User tags from Oura, with optional custom names via tag mappings                                                                                                                                                |

All data is also preserved as raw JSON in the `raw_records` table.

## Admin Setup

The server administrator must register an Oura developer application and configure:

| Environment Variable | Description                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `OURA_CLIENT`        | OAuth client ID from [Oura Developer Portal](https://cloud.ouraring.com/oauth/applications) |
| `OURA_SECRET`        | OAuth client secret                                                                         |
| `WEB_HOST`           | Public URL of the server (e.g., `https://aurboda.net`). Must be HTTPS for webhooks.         |

The OAuth callback URL to register with Oura is: `{WEB_HOST}/auth/ouracb`

If these are not set, the "Connect Oura" button in user settings will be disabled with a message asking the admin to configure them.

## User Setup

1. Go to **Settings > Data Sources > Oura Ring**
2. Click **Connect Oura**
3. Authorize Aurboda on the Oura website
4. You'll be redirected back. Settings will show "Connected" when successful.

This uses a standard OAuth 2.0 flow. The access token is stored per-user and automatically refreshed when it expires.

## Pull-Based Sync

Manually trigger a sync to fetch the latest data:

- **REST:** `POST /api/sync/oura`
- **MCP:** `sync_oura()`

Options:

- `full_resync: true` -- Re-fetch all historical data (default: last 90 days)
- `start_date: "YYYY-MM-DD"` -- Start date for full resync

The sync fetches all 7 data types sequentially. Each type tracks its own sync state, so only new data since the last sync is fetched during incremental syncs.

Rate limiting (HTTP 429) is handled automatically with exponential backoff (1, 5, 15, 60 minutes).

## Webhook Push (Near-Real-Time)

When enabled, Oura sends notifications to Aurboda whenever new data is available, enabling near-real-time sync without polling.

### How It Works

1. Admin enables webhooks in **Admin Settings > Integrations > Oura Webhook Push**
2. The server creates webhook subscriptions with Oura for all data types (create + update events)
3. When Oura has new data for any connected user, it sends a notification to `{WEB_HOST}/api/webhooks/oura`
4. The server looks up which local user the notification is for (via the Oura user ID mapping created during OAuth) and triggers a sync for that user and data type
5. Notifications are debounced (5-second window) to batch rapid updates

### Subscription Lifecycle

- **14 subscriptions** are created (7 data types x 2 event types: create, update)
- Subscriptions expire after ~30 days
- A renewal timer runs every 12 hours and renews subscriptions expiring within 24 hours
- A verification token is auto-generated and stored server-side to validate incoming webhooks

### Per-User Behavior

Webhooks are a **system-level** feature, not per-user. Once the admin enables webhooks:

- All currently connected Oura users automatically benefit from push sync
- New users who connect Oura after webhooks are enabled also benefit -- the user-to-Oura-ID mapping is created during the OAuth flow
- No re-authentication is needed for existing users

### Requirements

- `WEB_HOST` must use HTTPS (the toggle is hidden if HTTP)
- `OURA_CLIENT` and `OURA_SECRET` must be configured
- The webhook endpoint must be publicly accessible

### Disabling

When the admin disables webhooks, all remote subscriptions are deleted from Oura and local tracking records are cleaned up.
