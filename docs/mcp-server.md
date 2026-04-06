# MCP Server

Aurboda includes an MCP (Model Context Protocol) server that enables AI assistants like Claude to access all capabilities of the platform -- querying data, creating activities, managing rules, and more.

## Overview

The MCP server exposes 60+ tools covering all of Aurboda's functionality. Tool descriptions, parameters, and schemas are self-documented via the MCP protocol itself -- AI assistants discover available tools automatically.

Key areas covered by MCP tools:

- **Querying** -- daily summaries, metrics, activities, tags, meals, reports, correlations, trends, chart data
- **Tracking** -- add/update/delete activities, tags, metrics, meals, notes
- **Activity types** -- manage custom activity type definitions
- **Deduction rules** -- create rules that auto-generate activities from data conditions
- **Screentime** -- manage category rules and recategorize
- **Sync** -- trigger data syncs from Garmin, Oura, Last.fm, RescueTime, calendars
- **Settings** -- user preferences, HR zones, training load configuration

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

## Error Handling

The MCP server returns standard JSON-RPC error responses:

- Invalid metric names will list all valid metrics in the error message
- Invalid date formats will prompt for ISO 8601 format
- Authentication errors return HTTP 401
- Session mismatch errors return HTTP 403
