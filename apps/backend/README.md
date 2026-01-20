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
PGUSER=aurboda_service    # Service account username
PGPASSWORD=<password>      # Service account password
PGHOST=localhost           # Database host
PGPORT=5432                # Database port (default: 5432)
```

### Creating the Service Account

The service account needs `CREATEDB` privilege to create per-user databases:

```bash
sudo -u postgres psql -c "CREATE USER aurboda_service WITH ENCRYPTED PASSWORD 'your_password' CREATEDB"
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

# The extension is enabled per-database automatically when schema is initialized
```

## MCP Server

The backend includes an MCP server for AI assistant integration. See [/docs/mcp-server.md](/docs/mcp-server.md) for full documentation.
