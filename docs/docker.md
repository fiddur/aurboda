# Docker Setup

This guide covers running Aurboda using Docker and Docker Compose.

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
- **aurboda-web** (web frontend) on port 8080
- **aurboda-backend** (API server) on port 3000
- **postgres** (PostGIS) on port 5432

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
| `PGPASSWORD` | PostgreSQL password | `aurboda_dev_password` |
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

Docker images are automatically built and pushed to Docker Hub on merge to `develop`.

### Pull the latest images:

```bash
docker pull fiddur/aurboda-backend:latest
docker pull fiddur/aurboda-web:latest
```

### Run the backend with your own PostgreSQL:

```bash
docker run -d \
  --name aurboda-backend \
  -p 3000:3000 \
  -e PGHOST=your-postgres-host \
  -e PGPORT=5432 \
  -e PGUSER=aurboda_service \
  -e PGPASSWORD=your-password \
  -e SESSION_SALT=your-32-byte-secret \
  fiddur/aurboda-backend:latest
```

### Run the web frontend:

```bash
docker run -d \
  --name aurboda-web \
  -p 8080:80 \
  fiddur/aurboda-web:latest
```

## Production Deployment

### docker-compose.prod.yml

For production, create a `docker-compose.prod.yml`:

```yaml
services:
  aurboda-web:
    image: fiddur/aurboda-web:latest
    ports:
      - "8080:80"
    depends_on:
      - aurboda-backend
    restart: unless-stopped

  aurboda-backend:
    image: fiddur/aurboda-backend:latest
    ports:
      - "3000:3000"
    environment:
      - PGHOST=${PGHOST}
      - PGPORT=${PGPORT:-5432}
      - PGUSER=${PGUSER}
      - PGPASSWORD=${PGPASSWORD}
      - SESSION_SALT=${SESSION_SALT}
      - NODE_ENV=production
    depends_on:
      postgres:
        condition: service_healthy
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
  aurboda-web:
    image: fiddur/aurboda-web:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.aurboda-web.rule=Host(`health.example.com`)"
      - "traefik.http.routers.aurboda-web.tls.certresolver=letsencrypt"
      - "traefik.http.services.aurboda-web.loadbalancer.server.port=80"
    depends_on:
      - aurboda-backend
    networks:
      - traefik
      - default

  aurboda-backend:
    image: fiddur/aurboda-backend:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.aurboda-api.rule=Host(`health.example.com`) && PathPrefix(`/api`)"
      - "traefik.http.routers.aurboda-api.tls.certresolver=letsencrypt"
      - "traefik.http.services.aurboda-api.loadbalancer.server.port=3000"
      - "traefik.http.middlewares.strip-api.stripprefix.prefixes=/api"
      - "traefik.http.routers.aurboda-api.middlewares=strip-api"
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

### Build the Docker images:

```bash
# Backend
docker build -t aurboda-backend -f apps/backend/Dockerfile .

# Web frontend
docker build -t aurboda-web -f apps/web/Dockerfile .
```

### Run tests in Docker:

```bash
docker run --rm aurboda-backend pnpm --filter aurboda-backend test
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
docker compose logs -f aurboda-web
docker compose logs -f aurboda-backend
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

If the backend fails to start, check that:
1. PostgreSQL is healthy: `docker compose ps`
2. Environment variables are set correctly
3. SESSION_SALT is exactly 32 bytes

## CI/CD

Docker images are built automatically by GitHub Actions:

- **Trigger**: Push to `develop` branch
- **Registry**: Docker Hub
- **Images**:
  - `fiddur/aurboda-backend` - API server
  - `fiddur/aurboda-web` - Web frontend
- **Tags**:
  - `develop` - latest from develop branch
  - `<sha>` - specific commit
  - `latest` - latest from default branch
