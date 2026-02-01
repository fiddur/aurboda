# Aurboda Backend

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
# Required: PostgreSQL connection
PGUSER=aurboda_service    # Service account username
PGPASSWORD=<password>      # Service account password
PGHOST=localhost           # Database host
PGPORT=5432                # Database port (default: 5432)

# Optional: Location geocoding
GEOCODE_DB=aurboda                                        # Shared queue database (default: aurboda)
NOMINATIM_URL=https://nominatim.openstreetmap.org         # Nominatim API URL (default shown)
```

### Creating the Service Account

The service account needs `CREATEDB` privilege to create per-user databases, and `SUPERUSER` to enable the PostGIS extension in each user database:

```bash
sudo -u postgres psql -c "CREATE USER aurboda_service WITH ENCRYPTED PASSWORD 'your_password' CREATEDB SUPERUSER"
```

### Database Naming Convention

Each user gets their own database named `aurboda_{username}`. For example:
- User `fiddur` -> Database `aurboda_fiddur`
- User `alice` -> Database `aurboda_alice`

### For Existing Users (SET ROLE Permission)

When the backend uses `getDbForUser()`, it connects as PGUSER and then runs `SET ROLE '{username}'`. For this to work, PGUSER must be granted the target user's role.

New users created via `makeNewUserDb()` automatically grant this (line 39 in db.ts). For users created before this code existed, you need to manually grant:

```bash
sudo -u postgres psql -c "GRANT <username> TO <PGUSER>"
```

Example:
```bash
sudo -u postgres psql -c "GRANT fiddur TO aurboda_service"
```

### PostGIS Extension

Install PostGIS for your PostgreSQL version:

```bash
# Debian/Ubuntu (adjust version number)
sudo apt install postgresql-15-postgis-3
```

The PostGIS extension is automatically enabled in each user database when created via signup. This requires the service account to have `SUPERUSER` privilege (see above).

For existing users whose databases were created before this automation, manually enable PostGIS:

```bash
sudo -u postgres psql aurboda_<username> -c "CREATE EXTENSION IF NOT EXISTS postgis"
```

## Location Detection and Geocoding

The backend can automatically detect frequently visited locations and geocode them using Nominatim.

### How it works

1. When a location is received (via OwnTracks), detection is triggered with a 5-second debounce per user
2. The detection worker analyzes recent GPS data to find location clusters
3. New or moved locations are queued for geocoding via pg-boss
4. The geocoding queue respects Nominatim's rate limit (1 request per 1.1 seconds)

### Configuration

Geocoding is enabled by default using the `aurboda` database. The database is automatically created on startup if it doesn't exist (requires `CREATEDB` privilege on `PGUSER`).

To use a different database, set `GEOCODE_DB`:

```bash
GEOCODE_DB=aurboda  # default
```

Optionally set `NOMINATIM_URL` to use a different Nominatim server (e.g., self-hosted).

## MCP Server

The backend includes an MCP server for AI assistant integration. See [/docs/mcp-server.md](/docs/mcp-server.md) for full documentation.
