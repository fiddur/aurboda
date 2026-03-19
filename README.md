<p align="center">
  <img src="apps/web/public/logo.svg" alt="Aurboda" width="200" />
</p>

<h1 align="center">Aurboda</h1>
<h3 align="center">Self-Hosted Self-Quantification Aggregator</h3>

<p align="center">
  <a href="https://codecov.io/gh/fiddur/aurboda"><img src="https://codecov.io/gh/fiddur/aurboda/graph/badge.svg?flag=backend" alt="Backend Coverage" /></a>
</p>

Your health, fitness, productivity, and location data is scattered across apps and services. Aurboda aggregates it all into one self-hosted platform, provides rich visualizations, and exposes everything to AI assistants via [MCP (Model Context Protocol)](https://modelcontextprotocol.io/).

No public signup, but self-hosting is straightforward via Docker. It was initiated as a personal (manually coded) hobby project but has grown with AI coding; take it or leave it.

### Features

- [**Timeline**](docs/features/timeline.md) -- Multi-track interactive day view: activities, tags, metrics, screen time, music, and location
- [**Dashboard**](docs/features/dashboard.md) -- Customizable widget-based home page with metric cards, sparklines, trends, and correlations
- [**HR Zones**](docs/features/hr-zones.md) -- Weekly heart rate zone tracking with Huberman/Galpin protocol targets
- [**Correlation Analysis**](docs/features/correlations.md) -- Pearson coefficients, chi-squared tests, relative risk, activity impact timelines
- [**Trends (EMA)**](docs/features/trends.md) -- Exponential Moving Average smoothing for tags, metrics, and screen time
- [**Goals**](docs/features/goals.md) -- Rolling-window health targets with "losing tomorrow" calculations
- [**Sleep Analysis**](docs/features/sleep.md) -- Sleep quality tracking, hypnogram, Oura scores, sleep location detection
- [**Screentime Categories**](docs/features/screentime-categories.md) -- Hierarchical app categorization with productivity scoring
- [**Training Load**](docs/features/training-load.md) -- Banister model fitness/fatigue tracking (CTL/ATL/TSB)
- [**Places**](docs/features/places.md) -- GPS location history, auto-detected locations, visit tracking with PostGIS
- [**Lab Reports**](docs/features/lab-reports.md) -- Structured lab results with metric write-through and reference ranges
- [**Active Calorie Computation**](docs/features/calories.md) -- HR-based calculation with gap-fill from Health Connect
- **MCP Integration** -- Full AI assistant access via [Model Context Protocol](docs/mcp-server.md) (50+ tools)

### Data Sources

| Source | What it provides | Docs |
|---|---|---|
| [**Android Health Connect**](docs/health-connect.md) | Heart rate, HRV, sleep, exercise (80+ types), steps, weight, SpO2, VO2 max, calories, and more | Push from Android app |
| **BLE Sensors** | Real-time heart rate, HRV (Polar H10, etc.) and steps (Zwift RunPod, etc.) | Live via Android app |
| [**Oura Ring**](docs/oura.md) | Sleep stages/scores, readiness, resilience, cardiovascular age, HRV, heart rate, meditation, tags | Pull (API) + Push (webhooks) |
| [**Garmin Connect**](docs/garmin.md) | Daily summary, HR, HRV, sleep, stress, body battery, activities, SpO2, respiration, training readiness | Pull (session-based) |
| [**OwnTracks**](docs/owntracks.md) | GPS locations, geofences, place visits | Push (HTTP mode) |
| [**RescueTime**](docs/rescuetime.md) | App/website usage, productivity scores, categories | Pull (API) |
| [**ActivityWatch**](docs/activitywatch.md) | App/window usage per device (desktop and Android) | Push (agent script) |
| [**Last.fm**](docs/lastfm.md) | Music scrobbles with auto-generated tags from configurable rules | Pull (API) |
| [**Calendars (ICS)**](docs/calendars.md) | Calendar events imported as tags (Google Calendar, Outlook, iCloud, Nextcloud, etc.) | Pull (ICS fetch) |
| **Manual Entry** | Any metric, tag, activity, or note | Web UI, REST API, or MCP |

See [docs/data-sources.md](docs/data-sources.md) for setup overview.

---

## Timeline

See your entire day at a glance. The timeline overlays activities, tags, metrics, screen time, music, and location on a single interactive view. Hover over any item for details -- exercise sets and reps, sleep scores and stages, what music was playing, where you were.

<p align="center">
  <img src="apps/web/public/screenshots/timeline-detail.jpg" alt="Timeline with strength training details, heart rate, and location" width="800" />
</p>

<p align="center">
  <img src="apps/web/public/screenshots/timeline-sleep.jpg" alt="Timeline showing sleep details with Oura scores, efficiency, and multi-day view" width="800" />
</p>

The timeline is fully responsive and works on mobile browsers too:

<p align="center">
  <img src="apps/web/public/screenshots/timeline-mobile.jpg" alt="Timeline on mobile" width="300" />
</p>

## HR Zones & Fitness Tracking

Track time spent in each heart rate zone across all your exercises. Set weekly goals for Zone 2 cardio and Zone 5 high-intensity work based on exercise science recommendations (Huberman/Galpin protocols).

<p align="center">
  <img src="apps/web/public/screenshots/hr-zones.jpg" alt="HR zone minutes breakdown" width="350" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="apps/web/public/screenshots/widget-zones.jpg" alt="Android home screen widget for HR zones" width="350" />
</p>

The Android app includes a home screen widget so you can see your weekly zone progress without opening the app.

## Trends (EMA)

Track any metric or tag frequency over time with Exponential Moving Average smoothing. Configurable half-life (7/15/30 days) and display periods (daily, weekly, monthly).

<p align="center">
  <img src="apps/web/public/screenshots/trends.jpg" alt="Trend cards showing painkillers, coffee, weight, and custom metrics over time" width="800" />
</p>

## Places & Location History

Visualize your daily movements on a map. Aurboda detects frequently visited locations, lets you name them, and tracks visit durations. Powered by OwnTracks and PostGIS.

<p align="center">
  <img src="apps/web/public/screenshots/places.jpg" alt="Places view with location timeline and map" width="800" />
</p>

## AI-Ready via MCP

Connect Claude or other MCP-compatible AI assistants to your self-hosted instance. The AI gets full access to query your health data, find correlations, and generate personalized insights.

<p align="center">
  <img src="apps/web/public/screenshots/ai-insights.jpg" alt="AI-generated health insights analyzing sleep-exercise correlation" width="400" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="apps/web/public/screenshots/ai-chat.png" alt="AI chat conversation about health data" width="400" />
</p>

Example queries an AI can answer:

- "How was my sleep quality this week compared to last week?"
- "What's the correlation between my exercise and sleep scores?"
- "Show me days where I hit my Zone 2 cardio goals"
- "What's the probability of a headache the day after poor sleep?"

## Correlation Analysis

Go beyond simple charts. Aurboda computes statistical correlations between any combination of activities, tags, metrics, and productivity data. Includes Pearson correlation coefficients, chi-squared significance testing, relative risk ratios, and configurable lag windows (12h to 7 days).

Examples: Does evening exercise affect your sleep score? Does coffee intake correlate with HRV? What's the probability of a headache after a bad night?

## Android App

The companion Android app syncs data from Health Connect (40+ record types including heart rate, HRV, sleep, exercise, steps, weight, SpO2, and more). It also connects to BLE heart rate monitors (Polar H10, etc.) and step sensors (Zwift RunPod, etc.) for real-time tracking.

<p align="center">
  <img src="apps/web/public/screenshots/app.jpg" alt="Android app with HR zone tracking" width="250" />
  &nbsp;&nbsp;
  <img src="apps/web/public/screenshots/app-live.png" alt="Live BLE sensor screen" width="250" />
  &nbsp;&nbsp;
  <img src="apps/web/public/screenshots/widget.jpg" alt="Android home screen widget" width="250" />
</p>

---

## Quick Start (Docker)

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

- **aurboda** (web + API) on port 8080
- **PostgreSQL** with PostGIS
- **Watchtower** for automatic updates

### Creating Your User

Navigate to http://localhost:8080 and create your account through the web interface.

After creating your user, you can set `ALLOW_SIGNUP=false` in docker-compose.yml to disallow other signups.

### Environment Variables

| Variable         | Description                                | Default  |
| ---------------- | ------------------------------------------ | -------- |
| `SESSION_SECRET` | Secret for session tokens (32+ characters) | Required |
| `PGPASSWORD`     | PostgreSQL password                        | Required |
| `ALLOW_SIGNUP`   | Enable user registration endpoint          | `true`   |

### Port Configuration

To change default port, modify `"8080:80"` to `"YOUR_PORT:80"` in docker-compose.yml.

### Development Builds

Replace `:latest` with `:develop` in docker-compose.yml to use development builds.

---

## Architecture

```
                         +------------------+
                         |   Android App    |
                         | (Health Connect, |
                         |  BLE sensors)    |
                         +--------+---------+
                                  |
+------------------+     +--------v---------+     +------------------+
|  OwnTracks       +---->|     Backend      |<----+    Web UI        |
|  ActivityWatch   |     |  (REST API + MCP)|     |   (Preact)       |
|  Oura (webhooks) |     +--------+---------+     +------------------+
+------------------+         ^    |
                             |    |
+------------------+         |    v
|  Oura (API)      +---------+ +------------------+
|  RescueTime      |           |   PostgreSQL     |
|  Last.fm         |           |   (PostGIS)      |
|  Calendars (ICS) +---------+ +------------------+
+------------------+
```

**Components:**

- `apps/backend` -- Node.js/TypeScript API server with MCP support
- `apps/web` -- Preact-based visualization dashboard
- `apps/android` -- Kotlin/Jetpack Compose Health Connect client with BLE support
- `packages/api-spec` -- Shared Zod schemas, OpenAPI spec, generated TypeScript types and Kotlin models
- Database: PostgreSQL with PostGIS, per-user database isolation

---

## API Documentation

Interactive API documentation is available at https://aurboda.net/apispec (develop branch version).

---

## Development

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
SESSION_SECRET=your_32_byte_secret
```

---

## About the Name

In Norse mythology, Aurboda (pronounced "owr-BO-tha", using a hard D in "aurboda") is a mountain jotunn associated with strength and vitality. Her name means "gravel-offerer" or "gold-offerer", reflecting her role as a gatherer and provider.

This project embodies that spirit: gathering scattered health data into a unified foundation for understanding your wellbeing.

---

## Contact

Questions or want access? Contact me on [reddit](https://www.reddit.com/user/fiddur/).
