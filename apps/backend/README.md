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
