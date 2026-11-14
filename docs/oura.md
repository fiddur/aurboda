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

## Tags

An Oura tag carries a code (`tag_type_code`, such as `tag_sleep_sauna`) and, for a tag you made
yourself in the Oura app, a custom name. It becomes an activity whose `data` keeps the code as
`tag_key`. Its type is chosen in this order:

1. **Your tag mapping** for the code, if you have one: the mapped name resolves to one of your
   types by name or alias, else to a [built-in catalogue type](features/activity-type-catalog.md)
   whose name, display name or alias matches (a "Sauna" mapping lands on `sauna`, with its fields),
   else to a new custom type of that name.
2. Else the tag's **custom name**, resolved the same way.
3. Else, when the code is in the table below **and you have no type the code itself resolves to**
   (no type named after the code, no type with the code as an alias), the **table's type**. It is
   added from the catalogue if you do not have it yet.
4. Else the **code** resolves the same way as a name, which makes a custom type named after the code
   the first time.

**The field value follows the type.** Whenever the code is in the table and the tag lands on the
table's type, by whichever rule, the activity also gets the table's field value. A
`tag_generic_beer` tag lands on `alcohol` with `kind: "beer"`; if you mapped the code to "Beer" and
merged your own `beer` type into `alcohol`, the mapping now resolves to `alcohol` through the alias
the merge left, and the tag still gets `kind: "beer"`.

**Types made from codes before.** A sync before a code was in the table made a custom type named
after the code (`tag_generic_back_pain`). That type keeps receiving its tags: nothing is moved or
renamed by itself. Its page in the web app offers to merge it into its built-in type (**Built-in
type**, with the field value set on the moved activities). After the merge, new tags of that code
land on the built-in type with the value.

Oura publishes no list of its tag codes, so the table holds the codes seen so far. A code not in it
behaves as before: it creates (or keeps using) a type named after the code.

| Oura code                     | Type               | Field value             |
| ----------------------------- | ------------------ | ----------------------- |
| `tag_sleep_alcohol`           | `alcohol`          |                         |
| `tag_generic_beer`            | `alcohol`          | `kind: beer`            |
| `tag_generic_wine`            | `alcohol`          | `kind: wine`            |
| `tag_generic_coffee`          | `caffeine`         | `kind: coffee`          |
| `tag_generic_tea`             | `caffeine`         | `kind: tea`             |
| `tag_generic_nicotine`        | `nicotine`         |                         |
| `tag_generic_medication`      | `medication`       |                         |
| `tag_generic_pain_killer`     | `medication`       | `substance: painkiller` |
| `tag_generic_magnesium`       | `supplement`       | `substance: magnesium`  |
| `tag_sleep_latemeal`          | `late_meal`        |                         |
| `tag_generic_fasting`         | `fasting`          |                         |
| `tag_generic_ketodiet`        | `diet`             | `kind: keto`            |
| `tag_generic_cold`            | `illness`          | `kind: cold`            |
| `tag_generic_back_pain`       | `pain`             | `location: back`        |
| `tag_generic_joint_pain`      | `pain`             | `location: joint`       |
| `tag_generic_diarrhea`        | `diarrhea`         |                         |
| `tag_generic_fever`           | `fever`            |                         |
| `tag_generic_headache`        | `headache`         |                         |
| `tag_generic_sore_throat`     | `sore_throat`      |                         |
| `tag_generic_migraine`        | `migraine`         |                         |
| `tag_generic_sex`             | `sexual_activity`  |                         |
| `tag_sleep_sauna`             | `sauna`            |                         |
| `tag_generic_cold_exposure`   | `cold_exposure`    |                         |
| `tag_sleep_late_hotbath`      | `hot_bath`         |                         |
| `tag_generic_massage`         | `massage`          |                         |
| `tag_generic_theragun`        | `massage`          | `kind: massage_gun`     |
| `tag_generic_meditation`      | `meditation`       |                         |
| `tag_generic_breathwork`      | `guided_breathing` |                         |
| `tag_generic_sun`             | `sun_exposure`     |                         |
| `tag_generic_travel`          | `travel`           |                         |
| `tag_generic_airplane`        | `travel`           | `mode: plane`           |
| `tag_generic_car`             | `travel`           | `mode: car`             |
| `tag_generic_socialgathering` | `social_gathering` |                         |
| `tag_generic_nap`             | `nap`              |                         |

`nap` is the built-in nap type, not a catalogue type; every other code is listed in the catalogue
file as `oura_codes` on its entry or variant.

## Admin Setup

The server administrator must register an Oura developer application at the
[Oura Developer Portal](https://cloud.ouraring.com/oauth/applications) and then
configure the credentials in **Admin Settings > Integrations > Oura API**:

- **Client ID** — OAuth client ID from the Oura application
- **Client Secret** — OAuth client secret

The OAuth callback URL to register with Oura is: `{WEB_HOST}/auth/ouracb`, where
`WEB_HOST` (env var) is the public URL of the server (e.g., `https://aurboda.net`).
`WEB_HOST` must be HTTPS for webhooks.

If credentials are not configured, the "Connect Oura" button in user settings
will be disabled with a message asking the admin to configure them. Oura-related
sync jobs simply skip when credentials are missing — the backend will not crash.

> **Deprecated:** The `OURA_CLIENT` and `OURA_SECRET` environment variables are
> deprecated. On startup, if these env vars are set and the DB has no Oura
> credentials, they are migrated into the database once and then ignored.

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
- Oura Client ID and Client Secret must be configured in Admin Settings
- The webhook endpoint must be publicly accessible

### Disabling

When the admin disables webhooks, all remote subscriptions are deleted from Oura and local tracking records are cleaned up.

## Disconnecting

To disconnect Oura:

- **Settings:** Click "Disconnect" in the Oura Ring data source page
- **REST:** `POST /api/auth/oura/disconnect`

This revokes the authorization at Oura (best effort: a grant that is already dead, such as after a lapsed Oura subscription, is still removed locally), deletes the stored OAuth token, deletes the user's Oura sync state rows so nothing is retried or shown as failing, and deletes the user's Oura user-ID mapping so webhook events pushed for that user are ignored. The scheduled sync skips users without an Oura grant. Data already imported from Oura is kept.

Webhook subscriptions themselves are application-level and stay in place for the other connected users (see [Per-User Behavior](#per-user-behavior)).
