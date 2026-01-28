# Docker Setup

This guide covers running Aurboda using Docker and Docker Compose.

## Quick Start

### Using Docker Compose (Recommended)

1. Create a `.env` file with your session salt:

```bash
echo "SESSION_SECRET=$(openssl rand -base64 24)" > .env
```

2. Start the services:

```bash
docker compose up -d
```

This starts:
- **aurboda** (web frontend + API) on port 8080
- **postgres** (PostGIS) on port 5432
- **watchtower** for automatic updates

3. Open the web frontend at `http://localhost:8080` and register your first user.

### Development Mode

For development with hot reload:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This mounts your source code and watches for changes.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PGHOST` | PostgreSQL host | `postgres` |
| `PGPORT` | PostgreSQL port | `5432` |
| `PGUSER` | PostgreSQL user | `aurboda_service` |
| `PGPASSWORD` | PostgreSQL password | (required) |
| `SESSION_SECRET` | 32-byte secret for session encryption | (required) |
| `WEB_HOST` | Public URL of the web UI (for OAuth redirects) | `http://localhost:8080` |
| `ALLOW_SIGNUP` | Enable user registration | `true` |

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

Docker images are automatically built and pushed to Docker Hub on merge to `develop`.

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

### Using existing PostgreSQL

If you have PostgreSQL running on your host machine:

```yaml
services:
  aurboda:
    image: fiddur/aurboda:latest
    ports:
      - "8080:80"
    extra_hosts:
      - "host.docker.internal:host-gateway"  # Linux needs this
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
      - "traefik.enable=true"
      - "traefik.http.routers.aurboda.rule=Host(`health.example.com`)"
      - "traefik.http.routers.aurboda.tls.certresolver=letsencrypt"
      - "traefik.http.services.aurboda.loadbalancer.server.port=80"
    environment:
      - PGHOST=postgres
      - PGUSER=${PGUSER}
      - PGPASSWORD=${PGPASSWORD}
      - SESSION_SECRET=${SESSION_SECRET}
      - WEB_HOST=https://health.example.com
    networks:
      - traefik
      - default

networks:
  traefik:
    external: true
```

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

The container monitors both nginx and the backend. If either process crashes, the container exits and will be restarted by Docker's restart policy.

## CI/CD

Docker images are built automatically by GitHub Actions:

- **Trigger**: Push to `develop` branch
- **Registry**: Docker Hub
- **Image**: `fiddur/aurboda`
- **Tags**:
  - `develop` - latest from develop branch
  - `<sha>` - specific commit
  - `latest` - latest from main branch

## Architecture

The combined Docker image runs:
- **nginx** on port 80 - serves static web files and proxies `/api` to backend
- **Node.js backend** on 127.0.0.1:3000 - API server (only accessible via nginx)

This architecture:
- Simplifies deployment to a single container
- API is not directly exposed, only through nginx proxy
- Static assets benefit from nginx's caching and compression
