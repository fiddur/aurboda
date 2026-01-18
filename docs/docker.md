# Docker Setup

This guide covers running Nephelai using Docker and Docker Compose.

## Quick Start

### Using Docker Compose (Recommended)

1. Create a `.env` file with your session salt:

```bash
echo "SESSION_SALT=$(openssl rand -base64 24)" > .env
```

2. Start the services:

```bash
docker compose up -d
```

This starts:
- **backend** on port 3000
- **postgres** (PostGIS) on port 5432

3. Create your first user by visiting `http://localhost:3000` and registering.

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
| `PGUSER` | PostgreSQL user | `nephelai_service` |
| `PGPASSWORD` | PostgreSQL password | `nephelai_dev_password` |
| `SESSION_SALT` | 32-byte secret for session encryption | (required) |

### Generating a Session Salt

```bash
# Generate a random 32-byte base64 string
openssl rand -base64 24
```

Store this in your `.env` file:

```bash
SESSION_SALT=your_generated_salt_here
```

## Using Pre-built Images

Docker images are automatically built and pushed to GitHub Container Registry on merge to `develop`.

### Pull the latest image:

```bash
docker pull ghcr.io/fiddur/nephelai/backend:latest
```

### Run with your own PostgreSQL:

```bash
docker run -d \
  --name nephelai-backend \
  -p 3000:3000 \
  -e PGHOST=your-postgres-host \
  -e PGPORT=5432 \
  -e PGUSER=nephelai_service \
  -e PGPASSWORD=your-password \
  -e SESSION_SALT=your-32-byte-secret \
  ghcr.io/fiddur/nephelai/backend:latest
```

## Production Deployment

### docker-compose.prod.yml

For production, create a `docker-compose.prod.yml`:

```yaml
services:
  backend:
    image: ghcr.io/fiddur/nephelai/backend:latest
    ports:
      - "3000:3000"
    environment:
      - PGHOST=${PGHOST}
      - PGPORT=${PGPORT:-5432}
      - PGUSER=${PGUSER}
      - PGPASSWORD=${PGPASSWORD}
      - SESSION_SALT=${SESSION_SALT}
      - NODE_ENV=production
    restart: unless-stopped

  postgres:
    image: postgis/postgis:16-3.4-alpine
    environment:
      - POSTGRES_USER=${PGUSER}
      - POSTGRES_PASSWORD=${PGPASSWORD}
      - POSTGRES_DB=postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${PGUSER}"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  postgres_data:
```

### With Traefik (HTTPS)

```yaml
services:
  backend:
    image: ghcr.io/fiddur/nephelai/backend:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.nephelai.rule=Host(`health.example.com`)"
      - "traefik.http.routers.nephelai.tls.certresolver=letsencrypt"
      - "traefik.http.services.nephelai.loadbalancer.server.port=3000"
    environment:
      - PGHOST=postgres
      - PGUSER=${PGUSER}
      - PGPASSWORD=${PGPASSWORD}
      - SESSION_SALT=${SESSION_SALT}
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
docker build -t nephelai-backend -f apps/backend/Dockerfile .
```

### Run tests in Docker:

```bash
docker run --rm nephelai-backend pnpm --filter nephelai-backend test
```

## Volumes and Data

### PostgreSQL Data

The `postgres_data` volume persists your database. To back it up:

```bash
docker run --rm \
  -v nephelai_postgres_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/postgres-backup.tar.gz /data
```

### Restore from backup:

```bash
docker run --rm \
  -v nephelai_postgres_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/postgres-backup.tar.gz -C /
```

## Troubleshooting

### Check logs:

```bash
docker compose logs -f backend
docker compose logs -f postgres
```

### Connect to PostgreSQL:

```bash
docker compose exec postgres psql -U nephelai_service
```

### Reset everything:

```bash
docker compose down -v  # Warning: deletes all data!
docker compose up -d
```

### Health check failed:

If the backend fails to start, check that:
1. PostgreSQL is healthy: `docker compose ps`
2. Environment variables are set correctly
3. SESSION_SALT is exactly 32 bytes

## CI/CD

Docker images are built automatically by GitHub Actions:

- **Trigger**: Push to `develop` branch
- **Registry**: `ghcr.io/fiddur/nephelai/backend`
- **Tags**:
  - `develop` - latest from develop branch
  - `<sha>` - specific commit
  - `latest` - latest from default branch
