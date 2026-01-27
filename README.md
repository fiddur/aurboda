Aurboda - Self Quantification Aggregator
========================================

Backend [![Backend Coverage](https://codecov.io/gh/fiddur/aurboda/graph/badge.svg?flag=backend)](https://codecov.io/gh/fiddur/aurboda)
Web [![Web Coverage](https://codecov.io/gh/fiddur/aurboda/graph/badge.svg?flag=web)](https://codecov.io/gh/fiddur/aurboda)
Android [![Android Coverage](https://codecov.io/gh/fiddur/aurboda/graph/badge.svg?flag=android)](https://codecov.io/gh/fiddur/aurboda)

Your health data is scattered across apps and services. Aurboda aggregates it into one place, provides visualizations, and exposes it to AI assistants via MCP (Model Context Protocol).

**What it does:**

- **Aggregates** health data from Android Health Connect, Oura, OwnTracks, and RescueTime
- **Visualizes** heart rate zones, sleep patterns, location history, and exercise data
- **AI-ready** via MCP — optionally connect Claude or other AI assistants to your self-hosted instance to query your data

Currently in early development. No public signup, but self-hosting is straightforward.

<p align="center">
  <img src="apps/web/public/screenshots/app.jpg" alt="HR Zone tracking" width="280" />
  <img src="apps/web/public/screenshots/widget.jpg" alt="Home screen widget" width="280" />
</p>


Quick Start (Docker)
--------------------

```bash
# Download docker-compose.yml
curl -o docker-compose.yml https://raw.githubusercontent.com/fiddur/aurboda/main/docker-compose.yml

# Generate secure secrets (openssl ships with Git on Windows, standard on macOS/Linux)
sed -i.bak "s/REPLACE_DB_PASSWORD/$(openssl rand -hex 16)/" docker-compose.yml
sed -i.bak "s/REPLACE_SESSION_SECRET/$(openssl rand -hex 16)/" docker-compose.yml
rm docker-compose.yml.bak

# Start services
docker compose up -d
```

This starts:
- **aurboda-web** on port 8080
- **aurboda-backend** on port 3000
- **PostgreSQL** with PostGIS
- **Watchtower** for automatic updates

### Creating Your User

Navigate to http://localhost:8080 and create your account through the web interface.

Alternatively, create users directly in PostgreSQL (users are PostgreSQL roles with their own databases):

```bash
# Connect to the postgres container
docker compose exec postgres psql -U aurboda_service -d postgres

# Create a user (replace 'myuser' and 'mypassword')
CREATE USER myuser WITH ENCRYPTED PASSWORD 'mypassword';
GRANT myuser TO aurboda_service;
CREATE DATABASE aurboda_myuser OWNER myuser;
\q
```

Then log in at http://localhost:8080 with your username and password.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SESSION_SALT` | Secret for session tokens (32+ characters) | Required |
| `PGPASSWORD` | PostgreSQL password | Required |
| `ALLOW_SIGNUP` | Enable user registration endpoint | `true` |

### Port Configuration

To change default ports, modify your docker-compose.yml:
- Web UI: Change `"8080:80"` to `"YOUR_PORT:80"`
- Backend API: Change `"3000:3000"` to `"YOUR_PORT:3000"`

### Development Builds

Replace `:latest` with `:develop` in docker-compose.yml to use development builds.


Data Sources
------------

| Source | Setup |
|--------|-------|
| Android Health Connect | Install the [Android APK](https://github.com/fiddur/aurboda/releases/download/latest/aurboda.apk), enter your backend URL (e.g., `http://YOUR_SERVER_IP:3000`), and log in with your credentials |
| OwnTracks | [OwnTracks setup guide](docs/owntracks.md) (JSON HTTP mode) |
| Oura | Connect via OAuth in user settings (web UI). Requires `OURA_CLIENT` and `OURA_SECRET` env vars on backend. |
| RescueTime | Configure API key in user settings (web UI). Get key from [RescueTime API settings](https://www.rescuetime.com/anapi/manage). |


MCP Integration
---------------

The backend exposes an MCP server, allowing AI assistants to query your health data. Configure your MCP client to connect to the backend endpoint.

Example queries an AI can answer:
- "How was my sleep quality this week compared to last week?"
- "What's the correlation between my exercise and sleep scores?"
- "Show me days where I hit my Zone 2 cardio goals"


Architecture
------------

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Android App    │────▶│    Backend      │◀────│   Web UI        │
│  (Health Connect)     │  (API + MCP)    │     │  (Preact)       │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
┌─────────────────┐     ┌────────▼────────┐
│  OwnTracks      │────▶│   PostgreSQL    │
│  Oura, RescueTime     │   (PostGIS)     │
└─────────────────┘     └─────────────────┘
```

**Components:**

- `apps/backend` - Node.js API server with MCP support, PostgreSQL/PostGIS for storage
- `apps/web` - Preact-based visualization dashboard
- `apps/android` - Health Connect data collector with HR zone widget


Development
-----------

```bash
pnpm install
pnpm fix    # Format and lint
pnpm check  # TypeScript checks
```

Backend requires PostgreSQL with PostGIS. Configure connection in `.env`:
```
PGHOST=localhost
PGPORT=5432
PGUSER=aurboda_service
PGPASSWORD=your_password
SESSION_SALT=your_32_byte_secret
```


About the Name
--------------

In Norse mythology, Aurboða (pronounced "owr-BO-tha", using a hard D in "aurboda") is a mountain jötunn associated with strength and vitality. Her name means "gravel-offerer" or "gold-offerer", reflecting her role as a gatherer and provider.

This project embodies that spirit: gathering scattered health data into a unified foundation for understanding your wellbeing.


Contact
-------

Questions or want access? Contact me on [reddit](https://www.reddit.com/user/fiddur/).
