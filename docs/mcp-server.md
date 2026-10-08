# MCP Server

Aurboda includes an MCP (Model Context Protocol) server that enables AI assistants like Claude to access all capabilities of the platform -- querying data, creating activities, managing rules, and more.

## Overview

The MCP server exposes 60+ tools covering all of Aurboda's functionality. Tool descriptions, parameters, and schemas are self-documented via the MCP protocol itself -- AI assistants discover available tools automatically.

Key areas covered by MCP tools:

- **Querying** -- daily summaries, metrics, activities, tags, meals, reports, correlations, trends, chart data
- **Tracking** -- add/update/delete activities, tags, metrics, meals, comments
- **Activity types** -- manage custom activity type definitions
- **Deduction rules** -- create rules that auto-generate activities from data conditions
- **Screentime** -- manage category rules and recategorize
- **Sync** -- trigger data syncs from Garmin, Oura, Last.fm, RescueTime, calendars
- **Settings** -- user preferences, HR zones, training load configuration

### Sleep tools

| Tool               | What it does                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_latest_sleep` | "How did I sleep last night?" -- the most recent sleep ending within 36 hours: timing, score, stage timeline and minutes, resting HR and HRV against 30-day baselines, Body Battery at bedtime and wake-up |

### Chart data tools

| Tool               | What it does                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `query_chart_data` | Bucketed counts, sums or means of an activity type, metric (including computed `hr_zone_<n>_sec`) or screentime category, the same as `GET /chart-data`. `tz` (IANA, e.g. `Europe/Stockholm`) makes daily, weekly and monthly buckets start at local midnight, local Monday and the local 1st, and hourly ones at the local hour; omitted, buckets are UTC. The web app sends the browser's zone |

### Activity session tools

See [Activity types -- sessions overview](features/activity-types.md#sessions-overview).

| Tool                         | What it does                                                                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query_activity_sessions`    | Sessions of one type, each with length, avg/max HR, HR-zone seconds and a box-plot summary of its HR samples; with `group_by` (a categorical data field) also one group per value, to compare repeats or pick a session by length and effort |
| `get_activity_neighbors`     | The previous and next activity of the same type, optionally only those sharing a data field value (`same_field`, e.g. `session_name`)                                                                                                        |
| `list_activity_field_values` | The values a data field (e.g. `session_name`) has taken across a type and its subtypes, most recently used first, with counts -- for reusing a value instead of spelling a new variant                                                       |

### Activity track tools

See [Routes and segments](features/routes-and-segments.md).

| Tool                       | What it does                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_activity_track`       | An activity's full-resolution GPS track: `lat`, `lon`, `alt` and `t` (seconds since the activity start) per point, with `length_m` and `point_count` |
| `backfill_activity_tracks` | Build missing tracks from stored raw records (Garmin details at full resolution, Strava polylines shape-only) and return the counts                  |

### Route tools

A route is a course run more than once, recognised from the tracks. See
[Routes and segments](features/routes-and-segments.md#phase-2-routes). `query_activities`
takes a `route_id` to list a route's activities.

| Tool           | What it does                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `list_routes`  | Every route with its activity type, length, run count and latest run, most recently run first                                             |
| `get_route`    | One route with its line and its runs, newest first: elapsed seconds, average heart rate and pace (s/km) per run                           |
| `update_route` | Rename a route                                                                                                                            |
| `delete_route` | Delete a route; its activities are kept and become unrouted                                                                               |
| `merge_routes` | Move every run of `source_route_id` onto the route `id` and delete the source                                                             |
| `match_routes` | Match every tracked activity without a route (attach to a covering route, or pair two unrouted tracks into a new one); returns the counts |

### Comment tools

Comments (stored as "notes") hang off anything, or off a bare point in time, and
can be threaded one level deep. See [Comments](features/comments.md) for the data
model.

| Tool          | What it does                                                                                                                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_note`    | Add a comment in one of three shapes: on an entity (`entity_type` + `entity_id`), a reply (`entity_type: "note"`, `entity_id` = the comment's id), or about a moment (`entity_type: "time"`, no `entity_id`, `start_time` required, `end_time` optional) |
| `get_notes`   | All comments on one entity, each with its thread nested in `replies` (oldest first)                                                                                                                                                                      |
| `query_notes` | Every comment anchored in a `from`/`to` time range -- threads nested, replies never listed separately                                                                                                                                                    |
| `update_note` | Change a comment's content; `start_time`/`end_time` only on a `time` comment, and moving one moves its whole thread                                                                                                                                      |
| `delete_note` | Delete a comment; deleting a thread root deletes its replies too                                                                                                                                                                                         |

## Endpoint

The MCP server is available at `/mcp` and uses the Streamable HTTP transport:

- `POST /mcp` - Handle JSON-RPC requests
- `GET /mcp` - SSE stream for server notifications
- `DELETE /mcp` - End session

## Authentication

The MCP server supports two authentication methods:

### OAuth 2.1 (for Claude.ai Custom Connectors)

The server implements OAuth 2.1 with PKCE (S256) for clients that support it, such as Claude.ai custom connectors.

**Discovery:** `GET /.well-known/oauth-authorization-server` returns the authorization server metadata.

**OAuth endpoints:**

| Endpoint     | Method | Description                              |
| ------------ | ------ | ---------------------------------------- |
| `/register`  | POST   | Dynamic client registration (RFC 7591)   |
| `/authorize` | GET    | Serves login form with OAuth params      |
| `/authorize` | POST   | Handles login + redirects with auth code |
| `/token`     | POST   | Exchanges auth code or refresh token     |

**Supported grants:** `authorization_code` (with PKCE S256), `refresh_token`

**Token lifetimes:** Access tokens expire after 1 hour, refresh tokens after 30 days.

**Connecting Claude.ai:**

1. In Claude.ai, add a custom connector with the MCP URL: `https://aurboda.net/mcp`
2. Claude.ai will auto-discover the OAuth endpoints via `/.well-known/oauth-authorization-server`
3. On first use, you will be redirected to sign in with your Aurboda credentials
4. Claude.ai handles token refresh automatically

### Bearer Token (for Claude Desktop / API clients)

For direct API access, use the existing AES-256-GCM Bearer token:

1. Obtain a token via `POST /api/login`
2. Include the token in the `Authorization` header: `Authorization: Bearer <token>`

Both authentication methods are supported simultaneously. Each MCP session is scoped to the authenticated user.

## Available Metrics

The following metrics are available for querying and manual entry:

| Metric                     | Unit        | Description                    |
| -------------------------- | ----------- | ------------------------------ |
| `heart_rate`               | bpm         | Heart rate in beats per minute |
| `resting_heart_rate`       | bpm         | Resting heart rate             |
| `hrv_rmssd`                | ms          | Heart rate variability (RMSSD) |
| `weight`                   | kg          | Body weight                    |
| `body_fat`                 | percent     | Body fat percentage            |
| `bone_mass`                | kg          | Bone mass                      |
| `lean_body_mass`           | kg          | Lean body mass                 |
| `body_water_mass`          | kg          | Body water mass                |
| `height`                   | m           | Height in meters               |
| `steps`                    | count       | Step count                     |
| `distance`                 | m           | Distance traveled              |
| `floors_climbed`           | count       | Floors climbed                 |
| `calories_active`          | kcal        | Active calories burned         |
| `calories_total`           | kcal        | Total calories burned          |
| `calories_basal`           | kcal        | Basal metabolic calories       |
| `spo2`                     | percent     | Blood oxygen saturation        |
| `respiratory_rate`         | breaths/min | Respiratory rate               |
| `body_temperature`         | celsius     | Body temperature               |
| `basal_body_temperature`   | celsius     | Basal body temperature         |
| `blood_glucose`            | mmol/L      | Blood glucose level            |
| `blood_pressure_systolic`  | mmHg        | Systolic blood pressure        |
| `blood_pressure_diastolic` | mmHg        | Diastolic blood pressure       |
| `vo2_max`                  | mL/kg/min   | VO2 max                        |
| `readiness_score`          | score       | Readiness score (0-100)        |
| `resilience_score`         | score       | Resilience score (0-100)       |
| `productivity_score`       | score       | Productivity score (0-100)     |

## Connecting with Claude Desktop

To connect Claude Desktop to your Aurboda MCP server:

1. Start the Aurboda backend server
2. Obtain an authentication token via the login endpoint
3. Configure Claude Desktop with the MCP server URL and Bearer token

Example Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "aurboda": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <your-token-here>"
      }
    }
  }
}
```

## Example Conversations

Once connected, you can ask Claude questions like:

- "What was my heart rate yesterday?"
- "Show me a summary of my health data for January 15th"
- "How many steps did I take last week?"
- "Log that I just had a coffee"
- "Record my weight as 75.5 kg"
- "I meditated for 30 minutes starting at 2pm - add that as a tag"
- "Note that I felt dizzy around 11:40 this morning"
- "What did I comment on yesterday?"

## Error Handling

The MCP server returns standard JSON-RPC error responses:

- Invalid metric names will list all valid metrics in the error message
- Invalid date formats will prompt for ISO 8601 format
- Authentication errors return HTTP 401
- Session mismatch errors return HTTP 403
