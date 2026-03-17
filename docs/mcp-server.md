# MCP Server

Aurboda includes an MCP (Model Context Protocol) server that enables AI assistants like Claude to query health metrics and add manual tracking data.

## Overview

The MCP server provides 4 tools for AI assistants:

| Tool                | Description                                         |
| ------------------- | --------------------------------------------------- |
| `query_metrics`     | Query time series health data for a date range      |
| `get_daily_summary` | Get a comprehensive summary for a specific day      |
| `add_tag`           | Add a manual tag/label to mark an activity or event |
| `add_metric`        | Add a manual health metric measurement              |

## Endpoint

The MCP server is available at `/mcp` and uses the Streamable HTTP transport:

- `POST /mcp` - Handle JSON-RPC requests
- `GET /mcp` - SSE stream for server notifications
- `DELETE /mcp` - End session

## Authentication

The MCP server uses the same Bearer token authentication as the REST API:

1. Obtain a token via `POST /api/v2/login`
2. Include the token in the `Authorization` header: `Authorization: Bearer <token>`

Each MCP session is scoped to the authenticated user.

## Tools

### query_metrics

Query health metrics for a time range. Returns time series data with timestamps and values.

**Parameters:**

- `metric` (required) - The metric name (see [Available Metrics](#available-metrics))
- `start` (required) - Start date/time in ISO 8601 format (e.g., `2024-01-15T00:00:00Z`)
- `end` (required) - End date/time in ISO 8601 format (e.g., `2024-01-15T23:59:59Z`)

**Response:**

```json
{
  "metric": "heart_rate",
  "unit": "bpm",
  "count": 150,
  "data": [
    { "time": "2024-01-15T08:00:00.000Z", "value": 72 },
    { "time": "2024-01-15T08:05:00.000Z", "value": 75 }
  ]
}
```

### get_daily_summary

Get a comprehensive summary of health data for a specific day including heart rate statistics, steps, sleep sessions, exercise sessions, tags, productivity, and visited places.

**Parameters:**

- `date` (required) - Date in YYYY-MM-DD format (e.g., `2024-01-15`)

**Response:**

```json
{
  "date": "2024-01-15",
  "heartRate": {
    "min": 55,
    "max": 140,
    "avg": 72,
    "count": 1440
  },
  "steps": {
    "total": 8500
  },
  "sleepSessions": [
    {
      "startTime": "2024-01-14T23:00:00.000Z",
      "endTime": "2024-01-15T07:00:00.000Z",
      "duration": 480,
      "data": { "quality": "good" }
    }
  ],
  "exerciseSessions": [
    {
      "startTime": "2024-01-15T18:00:00.000Z",
      "endTime": "2024-01-15T18:45:00.000Z",
      "duration": 45,
      "title": "Evening Run",
      "data": { "type": "running" }
    }
  ],
  "tags": [
    {
      "tag": "coffee",
      "startTime": "2024-01-15T09:00:00.000Z"
    }
  ],
  "places": [
    {
      "region": "Home",
      "startTime": "2024-01-15T00:00:00.000Z",
      "endTime": "2024-01-15T08:30:00.000Z",
      "duration": 510
    },
    {
      "region": "Office",
      "startTime": "2024-01-15T09:00:00.000Z",
      "endTime": "2024-01-15T17:30:00.000Z",
      "duration": 510
    }
  ],
  "productivity": {
    "totalDurationSec": 28800,
    "productiveSec": 21600,
    "veryProductiveSec": 14400,
    "distractingSec": 3600
  }
}
```

### add_tag

Add a manual tag/label to mark an activity or event. Tags can have a start time and optional end time.

**Parameters:**

- `tag` (required) - The tag/label text (e.g., "coffee", "meditation", "headache")
- `start_time` (required) - Start time in ISO 8601 format
- `end_time` (optional) - End time in ISO 8601 format. Omit for point-in-time tags.

**Response:**

```json
{
  "success": true,
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "tag": "meditation",
  "startTime": "2024-01-15T14:30:00.000Z",
  "endTime": "2024-01-15T15:00:00.000Z"
}
```

### add_metric

Add a manual health metric measurement. Use this to log data not captured automatically.

**Parameters:**

- `metric` (required) - The metric name (see [Available Metrics](#available-metrics))
- `value` (required) - The metric value (e.g., 72 for heart rate, 75.5 for weight)
- `time` (optional) - Measurement time in ISO 8601 format. Defaults to current time if omitted.

**Response:**

```json
{
  "success": true,
  "metric": "weight",
  "value": 75.5,
  "unit": "kg",
  "time": "2024-01-15T08:00:00.000Z"
}
```

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

## Session Management

The MCP server maintains per-user sessions:

- Sessions are created on the first request with a valid token
- The session ID is returned in the `Mcp-Session-Id` response header
- Include the session ID in subsequent requests via the `Mcp-Session-Id` header
- Sessions are isolated per user - a user cannot access another user's session
- Use `DELETE /mcp` to explicitly end a session

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
