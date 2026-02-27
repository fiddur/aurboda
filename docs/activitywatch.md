# ActivityWatch

[ActivityWatch](https://activitywatch.net/) is an open-source, privacy-preserving activity tracker that runs locally on your machine. It tracks which windows and applications you use, making it an alternative to RescueTime that keeps your data on your own device.

## Why ActivityWatch?

- **Open source and free** — no API key subscription required
- **Runs locally** — data stays on your device until you push it
- **More accurate** — tracks terminal emulators (Alacritty, etc.) and editors correctly
- **Multi-device** — one Aurboda account can receive pushes from multiple computers
- **Android support** — via the [aw-android](https://github.com/ActivityWatch/aw-android) app

## Architecture

ActivityWatch runs as a **local daemon** on your desktop or phone. Aurboda's backend runs on a server. Unlike RescueTime (cloud pull), the backend cannot query ActivityWatch directly.

**Solution:** A lightweight push agent runs on each device, periodically querying ActivityWatch's local REST API and forwarding events to Aurboda via `POST /api/sync/activitywatch`.

```
ActivityWatch (local)  →  Push Agent (cron/systemd)  →  Aurboda API
```

## Data Synced

Each record contains:

| Field                     | Description                                              |
| ------------------------- | -------------------------------------------------------- |
| `activity`                | Application name (e.g., "firefox", "emacs", "alacritty") |
| `duration_sec`            | Time spent in seconds                                    |
| `start_time` / `end_time` | Precise timestamps                                       |
| `device_name`             | Hostname or configured device name                       |
| `source`                  | Always `activitywatch`                                   |

Window titles are available in the raw ActivityWatch data but are not currently stored (to avoid sensitive information leaking into the database). Category and productivity scores are not assigned yet — see the [categorization follow-up](https://github.com/fiddur/aurboda/issues/218).

## Admin Setup

No server-side configuration is needed. Each user sets up their own push agent with their own API token.

## User Setup

### 1. Install ActivityWatch

Download and install ActivityWatch from [activitywatch.net](https://activitywatch.net/). Start the daemon — it runs on `http://localhost:5600` by default.

### 2. Get your Aurboda API token

1. Log into Aurboda and go to **Settings > Data Sources**
2. Find the **ActivityWatch** section
3. Click **Generate API Token** and copy the token

> Keep this token secure — it grants full access to your Aurboda account.

### 3. Set up the push agent

The push agent is a shell script that reads from ActivityWatch's local API and sends events to Aurboda.

#### Create the script

Save the following as `~/.local/bin/aw-to-aurboda.sh`:

```bash
#!/usr/bin/env bash
# ActivityWatch → Aurboda push agent
# Run periodically (e.g. every 5 minutes) via cron or systemd timer.

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
AURBODA_URL="${AURBODA_URL:-https://aurboda.net/api}"
AURBODA_TOKEN="${AURBODA_TOKEN:-}"           # set in environment or replace here
DEVICE_NAME="${DEVICE_NAME:-$(hostname)}"    # override to give a friendly name
AW_URL="${AW_URL:-http://localhost:5600}"
STATE_FILE="${XDG_STATE_HOME:-$HOME/.local/state}/aw-aurboda/last_sync"
LOOKBACK_HOURS="${LOOKBACK_HOURS:-1}"        # how far back to fetch on each run
# ──────────────────────────────────────────────────────────────────────────────

if [[ -z "$AURBODA_TOKEN" ]]; then
  echo "ERROR: AURBODA_TOKEN is not set" >&2
  exit 1
fi

mkdir -p "$(dirname "$STATE_FILE")"

# Determine time window
if [[ -f "$STATE_FILE" ]]; then
  START_TIME=$(cat "$STATE_FILE")
else
  START_TIME=$(date -u -d "${LOOKBACK_HOURS} hours ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -v-${LOOKBACK_HOURS}H +%Y-%m-%dT%H:%M:%SZ)  # macOS fallback
fi
END_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Find the aw-watcher-window bucket for this host
BUCKET_ID=$(curl -sf "${AW_URL}/api/0/buckets/" \
  | python3 -c "
import sys, json
buckets = json.load(sys.stdin)
for bid, b in buckets.items():
    if b.get('type') == 'currentwindow':
        print(bid)
        break
" || true)

if [[ -z "$BUCKET_ID" ]]; then
  echo "No aw-watcher-window bucket found — is ActivityWatch running?" >&2
  exit 0
fi

# Fetch events
EVENTS=$(curl -sf \
  "${AW_URL}/api/0/buckets/${BUCKET_ID}/events?start=${START_TIME}&end=${END_TIME}&limit=10000")

EVENT_COUNT=$(echo "$EVENTS" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)

if [[ "$EVENT_COUNT" -eq 0 ]]; then
  echo "No events in range ${START_TIME} → ${END_TIME}"
  echo "$END_TIME" > "$STATE_FILE"
  exit 0
fi

echo "Pushing ${EVENT_COUNT} events (${START_TIME} → ${END_TIME}) as device '${DEVICE_NAME}'"

# Transform and push
PAYLOAD=$(echo "$EVENTS" | python3 -c "
import sys, json
events = json.load(sys.stdin)
transformed = []
for e in events:
    app = e.get('data', {}).get('app', '')
    if not app:
        continue
    transformed.append({
        'timestamp': e['timestamp'],
        'duration': e['duration'],
        'app': app,
        'title': e.get('data', {}).get('title', ''),
    })
print(json.dumps({'device_name': '$(echo $DEVICE_NAME)', 'events': transformed}))
")

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${AURBODA_URL}/sync/activitywatch" \
  -H "Authorization: bearer ${AURBODA_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

if [[ "$HTTP_STATUS" -ge 200 && "$HTTP_STATUS" -lt 300 ]]; then
  echo "✓ Pushed successfully (HTTP ${HTTP_STATUS})"
  echo "$END_TIME" > "$STATE_FILE"
else
  echo "✗ Push failed (HTTP ${HTTP_STATUS})" >&2
  exit 1
fi
```

Make it executable:

```bash
chmod +x ~/.local/bin/aw-to-aurboda.sh
```

#### Configure the script

Set the required environment variables. Add these to `~/.profile` or `~/.zshenv`:

```bash
export AURBODA_URL="https://aurboda.net/api"   # your Aurboda server URL
export AURBODA_TOKEN="your-token-here"          # from Settings
export DEVICE_NAME="laptop"                     # friendly name for this device
```

#### Test it manually

```bash
AURBODA_URL=https://aurboda.net/api \
AURBODA_TOKEN=your-token \
DEVICE_NAME=laptop \
~/.local/bin/aw-to-aurboda.sh
```

### 4. Schedule the push agent

#### Option A: cron

```bash
crontab -e
```

Add:

```
*/5 * * * * AURBODA_URL=https://aurboda.net/api AURBODA_TOKEN=your-token DEVICE_NAME=laptop ~/.local/bin/aw-to-aurboda.sh >> ~/.local/state/aw-aurboda/push.log 2>&1
```

#### Option B: systemd user timer (Linux, recommended)

Create `~/.config/systemd/user/aw-aurboda.service`:

```ini
[Unit]
Description=ActivityWatch → Aurboda push agent
After=network-online.target

[Service]
Type=oneshot
EnvironmentFile=%h/.config/aw-aurboda/env
ExecStart=%h/.local/bin/aw-to-aurboda.sh
StandardOutput=journal
StandardError=journal
```

Create `~/.config/systemd/user/aw-aurboda.timer`:

```ini
[Unit]
Description=Run ActivityWatch → Aurboda push every 5 minutes

[Timer]
OnCalendar=*:0/5
Persistent=true

[Install]
WantedBy=timers.target
```

Create the environment file `~/.config/aw-aurboda/env`:

```ini
AURBODA_URL=https://aurboda.net/api
AURBODA_TOKEN=your-token-here
DEVICE_NAME=laptop
```

Enable and start:

```bash
chmod 600 ~/.config/aw-aurboda/env   # protect the token
systemctl --user daemon-reload
systemctl --user enable --now aw-aurboda.timer
systemctl --user status aw-aurboda.timer
```

## Multiple Computers

Each computer runs its own ActivityWatch daemon and its own push agent. Set a different `DEVICE_NAME` on each machine (e.g. `laptop`, `workstation`). All devices use the same `AURBODA_TOKEN`.

Aurboda stores a separate `device_name` with each productivity record. Existing RescueTime records have an empty device name. The unique deduplication key is `(source, start_time, activity, device_name)`, so data from different devices never conflicts.

## Android

The [ActivityWatch Android app](https://github.com/ActivityWatch/aw-android) runs `aw-server-rust` as a native library, exposing the standard ActivityWatch REST API at `localhost:5600` on the device. The Aurboda Android app queries it directly — no Tasker or Termux needed.

### Setup

1. Install [ActivityWatch for Android](https://github.com/ActivityWatch/aw-android) and ensure it is running.
2. Open the Aurboda app → **Sync** tab.
3. Enable the **ActivityWatch Sync** toggle.

That's it. Aurboda will sync app-usage events from ActivityWatch automatically, both during foreground "Sync Now" and in the background (every 15 minutes when background sync is enabled).

### How it works

- Aurboda checks `http://localhost:5600` for ActivityWatch availability (2-second timeout; skips silently if not reachable).
- It fetches app-usage buckets (`currentwindow` type or `aw-android-appevents-*` buckets).
- New events since the last sync are mapped to the `ActivityWatchEvent` format and POSTed to the backend with `is_mobile: true`.
- The `device_name` is set to the Android device model name automatically.
- Last sync time is tracked per bucket in SharedPreferences to avoid re-sending events.

## Sync Status

Check when each device last pushed:

- **REST:** `GET /api/sync/activitywatch/status`
- **MCP:** `get_sync_status(provider="activitywatch")`

## Transition from RescueTime

ActivityWatch data coexists with RescueTime data — both sources are stored under `source = 'rescuetime'` and `source = 'activitywatch'` respectively in the `productivity` table. All productivity queries return both sources transparently.

To switch completely, simply stop the RescueTime sync and keep only the ActivityWatch push agent running.
