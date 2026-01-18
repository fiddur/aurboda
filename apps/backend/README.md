# Nephelai Backend

This repo aims to collect a user's self quantification data into a single useful place.

## Setup and Use

1. Setup PostgreSQL (see below)
2. Setup `.env` (see `.env.sample`)
3. `corepack use && pnpm i`

### Start web (for user creation and authorization)

```bash
pnpm start
```

## PostgreSQL Setup

The backend requires a PostgreSQL database with PostGIS extension.

### Environment Variables

Set these in your `.env` file or environment:

```bash
PGUSER=nephelai_service    # Service account username
PGPASSWORD=<password>      # Service account password
PGHOST=localhost           # Database host
PGPORT=5432                # Database port (default: 5432)
```

### Creating the Service Account

The service account needs `CREATEDB` privilege to create per-user databases:

```bash
sudo -u postgres psql -c "CREATE USER nephelai_service WITH ENCRYPTED PASSWORD 'your_password' CREATEDB"
```

### Database Naming Convention

Each user gets their own database named `nephelai_{username}`. For example:
- User `fiddur` -> Database `nephelai_fiddur`
- User `alice` -> Database `nephelai_alice`

### For Existing Users (SET ROLE Permission)

When the backend uses `getDbForUser()`, it connects as PGUSER and then runs `SET ROLE '{username}'`. For this to work, PGUSER must be granted the target user's role.

New users created via `makeNewUserDb()` automatically grant this (line 39 in db.ts). For users created before this code existed, you need to manually grant:

```bash
sudo -u postgres psql -c "GRANT <username> TO <PGUSER>"
```

Example:
```bash
sudo -u postgres psql -c "GRANT fiddur TO nephelai_service"
```

### PostGIS Extension

Install PostGIS for your PostgreSQL version:

```bash
# Debian/Ubuntu (adjust version number)
sudo apt install postgresql-15-postgis-3

# The extension is enabled per-database automatically when schema is initialized
```

## Migration Script

To migrate data from the old schema to the new schema:

**Pre-requisite**: Ensure PGUSER can SET ROLE to the target user (see "For Existing Users" above):
```bash
sudo -u postgres psql -c "GRANT fiddur TO nephelai_service"
```

Then run:
```bash
pnpm migrate <username>
```

Example:
```bash
pnpm migrate fiddur
```

### Verifying Migration

```bash
# Check new tables exist
psql nephelai_fiddur -c "\dt"

# Check data counts
psql nephelai_fiddur -c "SELECT COUNT(*) FROM raw_records"
psql nephelai_fiddur -c "SELECT metric, COUNT(*) FROM time_series GROUP BY metric"
psql nephelai_fiddur -c "SELECT activity_type, COUNT(*) FROM activities GROUP BY activity_type"
psql nephelai_fiddur -c "SELECT COUNT(*) FROM locations"
psql nephelai_fiddur -c "SELECT COUNT(*) FROM oauth_tokens"
```

### If Migration Fails

Common issues:
1. **Permission denied to set role** - Run the GRANT command above to allow PGUSER to act as the user
2. **Database doesn't exist** - The database must already exist as `nephelai_{username}`
3. **PostGIS missing** - Install the PostGIS extension package

## MCP Server (Model Context Protocol)

The backend includes an MCP server that enables AI assistants (like Claude) to query health metrics and add manual tracking data.

### Endpoint

The MCP server is available at `/mcp` and uses the Streamable HTTP transport:

- `POST /mcp` - Handle JSON-RPC requests
- `GET /mcp` - SSE stream for server notifications
- `DELETE /mcp` - End session

### Authentication

All MCP endpoints require Bearer token authentication using the same tokens from `/api/v2/login`:

```
Authorization: Bearer <token>
```

Sessions are managed via the `Mcp-Session-Id` header, which is returned after initialization.

### Available Tools

#### 1. `query_metrics`

Query health metrics for a time range.

**Parameters:**
- `metric` (string): Metric name (see available metrics below)
- `start` (string): Start date/time in ISO 8601 format
- `end` (string): End date/time in ISO 8601 format

**Example:**
```json
{
  "name": "query_metrics",
  "arguments": {
    "metric": "heart_rate",
    "start": "2024-01-15T00:00:00Z",
    "end": "2024-01-15T23:59:59Z"
  }
}
```

#### 2. `get_daily_summary`

Get a comprehensive summary of health data for a specific day.

**Parameters:**
- `date` (string): Date in YYYY-MM-DD format

**Returns:** Heart rate stats, steps total, sleep/exercise sessions, tags, and productivity summary.

**Example:**
```json
{
  "name": "get_daily_summary",
  "arguments": {
    "date": "2024-01-15"
  }
}
```

#### 3. `add_tag`

Add a manual tag/label to mark an activity or event.

**Parameters:**
- `tag` (string): The tag/label text (e.g., "coffee", "meditation", "headache")
- `start_time` (string): Start time in ISO 8601 format
- `end_time` (string, optional): End time for duration-based tags

**Example:**
```json
{
  "name": "add_tag",
  "arguments": {
    "tag": "meditation",
    "start_time": "2024-01-15T10:00:00Z",
    "end_time": "2024-01-15T10:30:00Z"
  }
}
```

#### 4. `add_metric`

Add a manual health metric measurement.

**Parameters:**
- `metric` (string): Metric name
- `value` (number): The metric value
- `time` (string, optional): Measurement time (defaults to now)

**Example:**
```json
{
  "name": "add_metric",
  "arguments": {
    "metric": "weight",
    "value": 75.5,
    "time": "2024-01-15T08:00:00Z"
  }
}
```

### Available Metrics

| Metric | Unit | Description |
|--------|------|-------------|
| `heart_rate` | bpm | Heart rate |
| `resting_heart_rate` | bpm | Resting heart rate |
| `hrv_rmssd` | ms | Heart rate variability (RMSSD) |
| `weight` | kg | Body weight |
| `body_fat` | percent | Body fat percentage |
| `bone_mass` | kg | Bone mass |
| `lean_body_mass` | kg | Lean body mass |
| `body_water_mass` | kg | Body water mass |
| `height` | m | Height |
| `steps` | count | Step count |
| `distance` | m | Distance traveled |
| `floors_climbed` | count | Floors climbed |
| `calories_active` | kcal | Active calories burned |
| `calories_total` | kcal | Total calories burned |
| `calories_basal` | kcal | Basal calories |
| `spo2` | percent | Blood oxygen saturation |
| `respiratory_rate` | bpm | Respiratory rate |
| `body_temperature` | °C | Body temperature |
| `basal_body_temperature` | °C | Basal body temperature |
| `blood_glucose` | mmol/L | Blood glucose |
| `blood_pressure_systolic` | mmHg | Systolic blood pressure |
| `blood_pressure_diastolic` | mmHg | Diastolic blood pressure |
| `vo2_max` | mL/kg/min | VO2 max |
| `readiness_score` | score | Readiness score |
| `resilience_score` | score | Resilience score |
| `productivity_score` | score | Productivity score |

### Connecting with Claude Desktop

Add this to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "nephelai": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/mcp"],
      "env": {
        "MCP_HEADERS": "Authorization: Bearer <your-token>"
      }
    }
  }
}
```

Or use the MCP Inspector for testing:

```bash
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```
