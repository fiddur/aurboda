# Docker Setup

Aurboda is free software (AGPL-3.0), so you can run your own server instead of using a hosted one
such as aurboda.net. Once it has a public address it still federates: people on it can follow and
share with people on any other Aurboda server and on Mastodon, and join challenges hosted on other
Aurboda servers. To bring your data along from another server, export it there and restore it into
yours ([Exporting all your data](data-export.md)). All it needs is a machine with Docker; this guide
covers running Aurboda with Docker Compose.

## Quick Start

### Using Docker Compose (Recommended)

1. Download the compose file and fill in its two secrets:

```bash
curl -o docker-compose.yml https://raw.githubusercontent.com/fiddur/aurboda/main/docker-compose.yml
sed -i.bak "s/REPLACE_DB_PASSWORD/$(openssl rand -hex 16)/" docker-compose.yml
sed -i.bak "s/REPLACE_SESSION_SECRET/$(openssl rand -hex 16)/" docker-compose.yml
rm docker-compose.yml.bak
```

2. Start the services:

```bash
docker compose up -d
```

This starts:

- **aurboda** (web frontend + API) on port 8080
- **postgres** (PostGIS), reachable only from the `aurboda` container

3. Open the web frontend at `http://localhost:8080` and create your account. The first account on a
   fresh server is its admin. To serve it under its own domain, set `WEB_HOST` in the compose file
   to the public URL (see [Production Deployment](#production-deployment)).

### Development Mode

For development with hot reload:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This mounts your source code and watches for changes.

## Configuration

### Environment Variables

| Variable                                 | Description                                                                                                                                                         | Default                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `PGHOST`                                 | PostgreSQL host                                                                                                                                                     | `postgres`                             |
| `PGPORT`                                 | PostgreSQL port                                                                                                                                                     | `5432`                                 |
| `PGUSER`                                 | PostgreSQL user                                                                                                                                                     | `aurboda_service`                      |
| `PGPASSWORD`                             | PostgreSQL password                                                                                                                                                 | (required)                             |
| `SESSION_SECRET`                         | 32-byte secret for session encryption                                                                                                                               | (required)                             |
| `WEB_HOST`                               | Public URL of the web UI (for OAuth redirects)                                                                                                                      | `http://localhost:8080`                |
| `ALLOW_SIGNUP`                           | Enable user registration                                                                                                                                            | `true`                                 |
| `WEBAUTHN_RP_ID`                         | Passkey Relying Party ID (must be the public hostname the browser sees)                                                                                             | derived from `WEB_HOST`                |
| `WEBAUTHN_RP_NAME`                       | Display name shown by the user's authenticator                                                                                                                      | `Aurboda`                              |
| `WEBAUTHN_ORIGINS`                       | Comma-separated list of allowed origins for assertions                                                                                                              | `WEB_HOST`                             |
| `OIDC_ALLOW_HTTP_ISSUER`                 | Accept plain-`http` OpenID Connect issuers ([sso.md](sso.md)); for a local test provider only, never in production                                                  | `false`                                |
| `ANDROID_APP_PACKAGE`                    | Android app package name in `assetlinks.json`                                                                                                                       | `net.aurboda`                          |
| `ANDROID_APP_FINGERPRINTS`               | Comma-separated SHA-256 cert fingerprints (colon-separated hex) for the Android APKs you trust                                                                      | (empty — `assetlinks.json` returns []) |
| `HOME_ASSISTANT_ALLOW_PRIVATE_ADDRESSES` | `true` lets users' [Home Assistant](./home-assistant.md) URLs point at private/loopback addresses and plain `http` (for a server on the same LAN as Home Assistant) | `false` (public https only)            |
| `CALENDAR_ALLOW_PRIVATE_ADDRESSES`       | `true` lets users' [calendar ICS](./calendars.md) URLs point at private/loopback addresses (for a server on the same LAN as the calendar server)                    | `false` (public addresses only)        |
| `TRUST_PROXY`                            | Proxies whose `X-Forwarded-For` the backend trusts, in Express `trust proxy` form ([Behind your own proxy](#behind-your-own-proxy))                                 | `loopback` (the bundled nginx)         |

### Generating a Session Secret

```bash
# Generate a random 32-byte base64 string
openssl rand -base64 24
```

Store this in your `.env` file:

```bash
SESSION_SECRET=your_generated_salt_here
```

## Using Pre-built Images

Docker images are built and pushed to Docker Hub by GitHub Actions: `fiddur/aurboda:latest`
from `main` (releases) and `fiddur/aurboda:develop` from `develop` (every merged PR). Each
release is also tagged with its own version, `fiddur/aurboda:v1.0.<n>`, the same number as the
Android app of that release; see [Versions and rollback](#versions-and-rollback).

### Pull the latest image:

```bash
docker pull fiddur/aurboda:latest
```

### Run with Docker Compose (includes PostgreSQL):

```bash
# Download docker-compose.yml
curl -o docker-compose.yml https://raw.githubusercontent.com/fiddur/aurboda/main/docker-compose.yml

# Generate secure secrets
sed -i.bak "s/REPLACE_DB_PASSWORD/$(openssl rand -hex 16)/" docker-compose.yml
sed -i.bak "s/REPLACE_SESSION_SECRET/$(openssl rand -hex 16)/" docker-compose.yml
rm docker-compose.yml.bak

# Start services
docker compose up -d
```

### Updating

`fiddur/aurboda:latest` only moves when a release merges to `main`. Upgrade with
`docker compose pull && docker compose up -d`. The compose file no longer bundles Watchtower: the
original `containrrr/watchtower` speaks Docker API 1.25, which current Docker daemons reject. For
automatic updates, run the maintained fork, [`nickfedor/watchtower`](https://github.com/nicholas-fedor/watchtower),
which polls for a new `:latest` and restarts `aurboda` on it.

### Versions and rollback

Every release gets one number, `1.0.<n>`, shared by the server image and the Android app. The
[releases page](https://github.com/fiddur/aurboda/releases) lists them; each release's notes hold
the changes it brought and its APK. The number is a release counter (the commit count of the
release on `main`), not semantic versioning: a higher number is a later release, nothing more.

The running server says which version it is on its Help page (`/help`), in `GET /api/status`
(`version`) and in NodeInfo (`/.well-known/nodeinfo`). A `:develop` image reports its commit sha
instead.

To pin a release, name its tag instead of `latest` in `docker-compose.yml`:

```yaml
services:
  aurboda:
    image: fiddur/aurboda:v1.0.3600
```

and upgrade by changing the tag to a newer release and running
`docker compose pull && docker compose up -d`. A pinned tag never moves, so Watchtower leaves it
alone.

To roll back, set the tag to the previous release and run the same command. Schema changes are
expand-only (see [Overlapping deploys](#overlapping-deploys-expand-only-schema-changes)), so the
previous release runs against a database the newer one has migrated: every column it uses is
still there. Migrations are not undone, though, and the older release ignores whatever the newer
one stored only in its new columns, so back up before upgrading (see
[PostgreSQL Data](#postgresql-data)) if you may want to return to exactly where you were.

### Using existing PostgreSQL

If you have PostgreSQL running on your host machine, ensure your service account has `CREATEDB` and `SUPERUSER` privileges (required for creating user databases and enabling PostGIS):

```bash
sudo -u postgres psql -c "ALTER USER aurboda_service WITH CREATEDB SUPERUSER"
```

```yaml
services:
  aurboda:
    image: fiddur/aurboda:latest
    ports:
      - '8080:80'
    extra_hosts:
      - 'host.docker.internal:host-gateway' # Linux needs this
    environment:
      - PGHOST=host.docker.internal
      - PGPORT=5432
      - PGUSER=aurboda_service
      - PGPASSWORD=your_password
      - SESSION_SECRET=your_32_byte_secret
      - WEB_HOST=http://localhost:8080
    restart: unless-stopped
```

## Production Deployment

### With Traefik (HTTPS)

```yaml
services:
  aurboda:
    image: fiddur/aurboda:latest
    labels:
      - 'traefik.enable=true'
      - 'traefik.http.routers.aurboda.rule=Host(`health.example.com`)'
      - 'traefik.http.routers.aurboda.tls.certresolver=letsencrypt'
      - 'traefik.http.services.aurboda.loadbalancer.server.port=80'
    environment:
      - PGHOST=postgres
      - PGUSER=${PGUSER}
      - PGPASSWORD=${PGPASSWORD}
      - SESSION_SECRET=${SESSION_SECRET}
      - WEB_HOST=https://health.example.com
      - TRUST_PROXY=loopback,uniquelocal # see "Behind your own proxy"
    networks:
      - traefik
      - default

networks:
  traefik:
    external: true
```

### Behind your own proxy

The backend takes the client's address, which the [rate limits](admin.md#rate-limits) key on, from
`X-Forwarded-For`, but only for the hops it trusts. By default it trusts the bundled nginx alone
(`TRUST_PROXY=loopback`), which is right when clients connect to the container directly: a forged
header from a client cannot move the limit onto someone else's address.

With a reverse proxy in front of the container (Traefik, Caddy, another nginx, a tunnel), every
request reaches nginx from the proxy, so the backend sees the proxy's address for every visitor.
It then leaves the per-IP limits off and logs a warning once. To fix it:

1. Make the proxy send `X-Forwarded-For` with the client's address and drop whatever a client
   sent in that header itself. Traefik and Caddy do both by default for clients they do not
   trust; for nginx use `proxy_set_header X-Forwarded-For $remote_addr;` (not
   `$proxy_add_x_forwarded_for`, which keeps the client's own value).
2. Tell the backend to trust the proxy's address too, with `TRUST_PROXY`. It takes Express's
   [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html) forms; keep `loopback` in
   the list for the bundled nginx:

   ```yaml
   environment:
     # The proxy reaches the container over a Docker network (private addresses):
     - TRUST_PROXY=loopback,uniquelocal
     # or name the proxy's address or subnet exactly:
     # - TRUST_PROXY=loopback,172.18.0.0/16
   ```

   Trust only addresses that are your proxy. `uniquelocal` trusts every private address
   (10/8, 172.16/12, 192.168/16, fc00::/7), so a client on the same LAN could then pick its own
   address for the limits. Avoid a hop count: a number trusts that many hops whoever sent them.

### Health check

The image declares a `HEALTHCHECK` that fetches `/api/status` through nginx
every 10 s (60 s start period, 3 retries). The backend only starts listening
once startup is done, and `/api/status` reads the central database, so the
container turns `healthy` only when nginx, the backend and Postgres all answer.

```bash
docker inspect --format '{{.State.Health.Status}}' aurboda   # starting → healthy
```

A deploy script or proxy can wait for `healthy` before sending traffic to a new
container.

### Graceful shutdown and stop timeout

On `docker stop` (SIGTERM to the entrypoint):

1. The entrypoint forwards SIGTERM to the Node backend and waits for it.
2. The backend stops accepting connections, then in parallel lets in-flight
   requests finish (up to 3 s, after which open streams such as the live
   timeline are cut) and stops pg-boss (running jobs get up to 10 s; unfinished
   ones are failed and retried by the next instance). Then it closes its
   database pools and exits. The whole sequence is bounded at 25 s.
3. nginx quits gracefully, and the container exits with status 0.

Docker's default stop timeout is 10 s, after which it SIGKILLs the container.
Give it room for the 25 s bound:

```bash
docker run --stop-timeout 30 ...
```

or `stop_grace_period: 30s` in Compose (the bundled `docker-compose.yml` sets
it). The backend logs `Shutting down...` and `Shutdown complete in <n> ms`; a
`Process exited unexpectedly` line instead means a process died on its own.
Startup logs how many seconds after process start the central DB, pg-boss and
the HTTP listener became ready.

### Overlapping deploys: expand-only schema changes

A zero-downtime (blue/green) deploy starts the new container before stopping
the old one, so for a short while two versions run against the same databases.
Schema changes must therefore be expand-only: add tables and nullable (or
defaulted) columns, never drop or rename a column in the same release that
stops writing it. Remove the old column in a later release, once no running
version uses it.

## Building Locally

### Build the Docker image:

```bash
docker build -t aurboda .
```

### Run locally:

```bash
docker run -d \
  --name aurboda \
  -p 8080:80 \
  -e PGHOST=host.docker.internal \
  -e PGPORT=5432 \
  -e PGUSER=aurboda_service \
  -e PGPASSWORD=your_password \
  -e SESSION_SECRET=your_32_byte_secret \
  --add-host=host.docker.internal:host-gateway \
  aurboda
```

## Volumes and Data

### PostgreSQL Data

The `postgres_data` volume persists your database. To back it up:

```bash
docker run --rm \
  -v aurboda_postgres_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/postgres-backup.tar.gz /data
```

### Restore from backup:

```bash
docker run --rm \
  -v aurboda_postgres_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/postgres-backup.tar.gz -C /
```

### Per-user export

Each user can download their own database as a gzipped SQL dump from Settings and restore it into
another installation; see [Exporting all your data](data-export.md). The image runs the PostgreSQL 16
`pg_dump` for it, which matches the `postgis/postgis:16` server in `docker-compose.yml` and works against
older servers too. Against a newer server (17+) the export answers `503` until the image's client is
raised to match.

## Database connections and tuning

Each user has their own database, so the backend keeps one pool per user:

| Pool                     | Max connections | Notes                                                    |
| ------------------------ | --------------- | -------------------------------------------------------- |
| Per-user pool            | 5 per user      | Idle connections close after 30 s; idle pools drain to 0 |
| Live timeline (`LISTEN`) | +1 per user     | Only while that user has a live timeline open            |
| Central database pool    | 5               | Users, settings, shared data                             |
| pg-boss (job queue)      | 3               |                                                          |

Only active users hold connections, so the bundled `max_connections=200` in
`docker-compose.yml` covers roughly 30 users being active at the same moment
(6 each, plus 8 for the central pool and pg-boss). Raise it if you host more.

`connectionTimeoutMillis` (30 s) also bounds the wait for a free slot in a pool.
When all 5 of a user's connections are busy for longer than that — a slow query
holding them during a large sync, say — further queries for that user fail
instead of queueing indefinitely. In the backend logs that shows up as
`timeout exceeded when trying to connect` errors (and 500 responses) for that
user only; other users are unaffected.

### Postgres tuning

`docker-compose.yml` sets only `max_connections`; size the rest to the host.
Rough starting points:

- `shared_buffers` ≈ 25 % of the RAM available to Postgres
- `effective_cache_size` ≈ 50–75 % of that RAM
- `work_mem` modest, e.g. 16–32 MB — it is per sort/hash operation per
  connection, and there can be many connections
- `shm_size` on the container large enough for `shared_buffers` and parallel
  queries (Docker's default is 64 MB)

Pass them as `-c` flags on the Postgres command, e.g. for a host giving
Postgres 4 GB:

```yaml
postgres:
  image: postgis/postgis:16-3.4-alpine
  shm_size: 1g
  command: >
    postgres -c max_connections=200 -c shared_buffers=1GB -c effective_cache_size=3GB -c work_mem=16MB
```

## Troubleshooting

### Check logs:

```bash
docker compose logs -f aurboda
docker compose logs -f postgres
```

### Connect to PostgreSQL:

```bash
docker compose exec postgres psql -U aurboda_service
```

### Reset everything:

```bash
docker compose down -v  # Warning: deletes all data!
docker compose up -d
```

### Health check failed:

If the service fails to start, check that:

1. PostgreSQL is healthy: `docker compose ps`
2. Environment variables are set correctly
3. SESSION_SECRET is at least 32 characters

### Process crashes:

The container monitors both nginx and the backend. If either process crashes, the container exits (logging `Process exited unexpectedly`) and will be restarted by Docker's restart policy.

## CI/CD

Docker images are built automatically by GitHub Actions:

- **Trigger**: Push to `develop` (`.github/workflows/docker.yml`) or to `main`, where
  `.github/workflows/release.yml` calls it on every release
- **Registry**: Docker Hub
- **Image**: `fiddur/aurboda`
- **Tags**:
  - `latest` - from `main`: released state, what production runs
  - `v1.0.<n>` - from `main`: one release, never moved (the same number as its Android release)
  - `develop` - from `develop`: every merged PR, for beta instances
  - `<sha>` - specific commit (both branches)

### Cutting a release

Releases are `develop → main` pull requests, merged with a **merge commit**:

```bash
scripts/release-pr.sh        # opens or refreshes the PR, body = merged PRs since the last release
```

(Also available as the "Release PR" workflow in the Actions tab.) The script labels the PR
`release-tryout`, which makes the release tryout routine (`tryouts/routine.md`) boot the head
image fresh and as an upgrade of the previous release's image, and post a gate review. Merging
it runs `.github/workflows/release.yml`, which gives the release its number, `v1.0.<n>`
(`scripts/release-version.sh`: the commit count of the merge commit on `main`), and on every
release, whatever it touches, pushes `fiddur/aurboda:latest` and `fiddur/aurboda:v1.0.<n>` and
publishes the stable Android release `v1.0.<n>`, whose notes are the release PR's change list
(`scripts/release-notes.sh`). `develop` keeps feeding the `develop` image and the `beta` Android
pre-release.
The previous release is `main`'s tip before the release PR merges, and the upgrade leg starts
from the image that release shipped: the last image-relevant commit on the `develop` tip it
released, which `develop`'s own build already tagged `fiddur/aurboda:<sha7>`. The tryout derives
that from git, not from `:latest` (which only moves when `main` builds) and not from what
production happens to run.

## Architecture

The combined Docker image runs:

- **nginx** on port 80 - serves static web files and proxies `/api` to backend
- **Node.js backend** on 127.0.0.1:3000 - API server (only accessible via nginx)

This architecture:

- Simplifies deployment to a single container
- API is not directly exposed, only through nginx proxy
- Static assets benefit from nginx's caching and compression
