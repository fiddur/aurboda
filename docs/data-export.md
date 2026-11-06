# Exporting all your data

Every Aurboda user has their own PostgreSQL database (`aurboda_<username>`). **Settings → Export all
data → Download export** gives you a complete copy of it as a gzipped plain SQL dump,
`aurboda-<username>-<YYYY-MM-DD>.sql.gz`, made with `pg_dump`. It is the full-fidelity export: every
metric, activity, location, meal, note, setting, rule and feed post, in a form you can restore into your
own Aurboda installation (to move servers) or simply read and query with standard PostgreSQL tools.

The dump is plain SQL (`CREATE TABLE …`, `COPY … FROM stdin`), so `gunzip -c` shows exactly what it holds.

## Keep it safe

The dump holds everything in your database, **including the credentials Aurboda stores for your
integrations** (Garmin, Oura, Strava, Gravl and other tokens or passwords). Treat the file like a
password: don't share it or leave it somewhere public.

## What is not in it

Things the server keeps in its central database, outside yours, are not exported: your login password
and passkeys, admin status, MCP/OAuth connector grants, and the server's Oura/Strava webhook
registrations. After a move you sign up (or have an admin create you) on the new server, add passkeys
again, and reconnect integrations whose tokens belong to the old server's OAuth app.

## Getting the dump

- **Web and Android**: Settings → _Export all data_ → _Download export_. Android saves it to Downloads.
- **REST**: `POST /api/export/dump-link` with your bearer token answers `{ success, url, expires_at }`;
  download `url` (it carries its own token and needs no `Authorization` header). The link works for
  ten minutes and is spent once a download completes.
- **MCP**: the `export_data_dump` tool returns the same link.

One export per user runs at a time (a second answers `409`). The link's single use and that limit
are kept in the backend process's memory, so with more than one backend process (an overlapping
deploy, say) a link could be used once on each. The server needs `pg_dump` at least as
new as its PostgreSQL server; the Docker image ships a PostgreSQL 16 client to match the
`postgis/postgis:16` database in `docker-compose.yml`. Without it the export answers `503` and says why.

## Restoring into another Aurboda installation

These steps restore into a [Docker Compose install](docker.md) whose database service is `postgres` with
the superuser `aurboda_service` (as in `docker-compose.yml`). Replace `alice` with your username and the
file name with yours. Run them from the directory with the compose file.

1. **Sign up** on the target server with the username you want. This creates the role `alice` and the
   database `aurboda_alice`.

2. **Stop Aurboda** so nothing recreates the tables while the database is empty (a logged-in browser or
   the Android app's background sync would), then **recreate the database empty**, owned by you, with
   the extensions Aurboda uses (as superuser, because extensions need it):

   ```sh
   docker compose stop aurboda
   docker compose exec -T postgres psql -U aurboda_service -d postgres \
     -c 'DROP DATABASE "aurboda_alice" WITH (FORCE)' \
     -c 'CREATE DATABASE "aurboda_alice" OWNER "alice"'
   docker compose exec -T postgres psql -U aurboda_service -d aurboda_alice \
     -c 'CREATE EXTENSION postgis' -c 'CREATE EXTENSION pg_trgm' -c 'CREATE EXTENSION unaccent'
   ```

3. **Load the dump as your user**, so every restored table is owned by `alice`:

   ```sh
   (echo 'SET ROLE "alice";'; gunzip -c aurboda-alice-2026-11-06.sql.gz \
     | grep -v -e '^COMMENT ON EXTENSION' -e '^SET transaction_timeout') \
     | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U aurboda_service -d aurboda_alice
   ```

   The dump's `CREATE EXTENSION IF NOT EXISTS` lines only note that step 2 already created them. Its
   `COMMENT ON EXTENSION` lines would fail, since only the extension's owner may comment on it, and a
   dump made by a newer `pg_dump` than the target server sets `transaction_timeout`, which PostgreSQL
   16 does not know, so `grep -v` drops both; with `ON_ERROR_STOP=1` anything else that fails stops the restore and shows
   the error.

4. **Start Aurboda and log in** (`docker compose start aurboda`). The next request migrates the restored schema to the target server's version, so a dump
   from an older Aurboda restores into a newer one.

A restore into a server without Docker works the same way: run the `psql` commands as a superuser
against that server.

The backend's integration test (`apps/backend/src/services/export-dump.integration.test.ts`) dumps a
database with the real `pg_dump` and restores it with exactly these steps.
