#!/usr/bin/env bash
# Installs the ActivityWatch → Aurboda push agent on Linux or macOS and runs it every 5 minutes.
#
#   curl -fsSL __AURBODA_API_URL__/agents/activitywatch.sh | bash -s -- --token <TOKEN>
#
# Options:
#   --token <token>   your Aurboda API key (or set AURBODA_TOKEN)
#   --device <name>   name for this computer (default: its hostname)
#   --url <api url>   Aurboda API base URL (default: __AURBODA_API_URL__)
#   --uninstall       remove the agent, its schedule and its settings
#
# Re-running replaces the installed files and keeps a single schedule. Nothing needs sudo.

set -euo pipefail

DEFAULT_URL='__AURBODA_API_URL__'
AW_URL='http://localhost:5600'
LABEL='net.aurboda.aw-push'
CRON_MARK='# aw-aurboda'
AGENT="$HOME/.local/bin/aw-to-aurboda.sh"
CONFIG_DIR="$HOME/.config/aw-aurboda"
ENV_FILE="$CONFIG_DIR/env"
STATE_DIR="$HOME/.local/state/aw-aurboda"
SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

say() { printf '%s\n' "$*"; }
warn() { printf '! %s\n' "$*" >&2; }
die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}
matches() { printf '%s' "$1" | grep -Eq "$2"; }

usage() {
  say "Installs the ActivityWatch → Aurboda push agent and runs it every 5 minutes."
  say ""
  say "Usage: bash -s -- --token <TOKEN> [--device <name>] [--url <api url>]"
  say "       bash -s -- --uninstall"
}

write_agent() {
  mkdir -p "$(dirname "$AGENT")"
  cat >"$AGENT.tmp" <<'AGENT_EOF'
#!/usr/bin/env bash
# ActivityWatch → Aurboda push agent
# Run periodically (e.g. every 5 minutes) via cron or systemd timer.

set -euo pipefail

# Settings written by the installer; variables already in the environment win.
AW_AURBODA_ENV="${AW_AURBODA_ENV:-$HOME/.config/aw-aurboda/env}"
if [[ -z "${AURBODA_TOKEN:-}" && -r "$AW_AURBODA_ENV" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$AW_AURBODA_ENV"
  set +a
fi

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
# Use 5 minutes ago to give AFK watcher time to finalize heartbeats
END_TIME=$(date -u -d "5 minutes ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -v-5M +%Y-%m-%dT%H:%M:%SZ)  # macOS fallback

# Find the aw-watcher-window and aw-watcher-afk buckets for this host
BUCKETS_JSON=$(curl -sf "${AW_URL}/api/0/buckets/" || true)

BUCKET_ID=$(echo "$BUCKETS_JSON" | python3 -c "
import sys, json
buckets = json.load(sys.stdin)
for bid, b in buckets.items():
    if b.get('type') == 'currentwindow':
        print(bid)
        break
" 2>/dev/null || true)

AFK_BUCKET_ID=$(echo "$BUCKETS_JSON" | python3 -c "
import sys, json
buckets = json.load(sys.stdin)
for bid, b in buckets.items():
    if b.get('type') == 'afkstatus':
        print(bid)
        break
" 2>/dev/null || true)

if [[ -z "$BUCKET_ID" ]]; then
  echo "No aw-watcher-window bucket found — is ActivityWatch running?" >&2
  exit 0
fi

# Fetch window events
EVENTS=$(curl -sf \
  "${AW_URL}/api/0/buckets/${BUCKET_ID}/events?start=${START_TIME}&end=${END_TIME}&limit=10000")

# Fetch AFK events (used to filter out idle screentime)
AFK_EVENTS="[]"
if [[ -n "$AFK_BUCKET_ID" ]]; then
  AFK_EVENTS=$(curl -sf \
    "${AW_URL}/api/0/buckets/${AFK_BUCKET_ID}/events?start=${START_TIME}&end=${END_TIME}&limit=10000" || echo "[]")
fi

EVENT_COUNT=$(echo "$EVENTS" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)

if [[ "$EVENT_COUNT" -eq 0 ]]; then
  echo "No events in range ${START_TIME} → ${END_TIME}"
  echo "$END_TIME" > "$STATE_FILE"
  exit 0
fi

echo "Found ${EVENT_COUNT} events (${START_TIME} → ${END_TIME}) for device '${DEVICE_NAME}'"

# Transform, filter AFK, and push
PAYLOAD=$(python3 -c "
import sys, json
from datetime import datetime, timedelta, timezone

events = json.loads(sys.argv[1])
afk_events = json.loads(sys.argv[2])
device_name = sys.argv[3]

def parse_ts(ts):
    # Handle both 'Z' suffix and '+00:00' offset
    ts = ts.replace('Z', '+00:00')
    return datetime.fromisoformat(ts)

def utc_iso(dt):
    # Aurboda accepts UTC timestamps with a 'Z' suffix only
    return dt.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

# Build list of AFK periods
afk_periods = []
for ae in afk_events:
    if ae.get('data', {}).get('status') == 'afk':
        start = parse_ts(ae['timestamp'])
        end = start + timedelta(seconds=ae['duration'])
        afk_periods.append((start, end))

def is_during_afk(evt_start, evt_end):
    \"\"\"Check if the event falls entirely within an AFK period.\"\"\"
    for afk_start, afk_end in afk_periods:
        if evt_start >= afk_start and evt_end <= afk_end:
            return True
    return False

transformed = []
filtered_count = 0
for e in events:
    app = e.get('data', {}).get('app', '')
    if not app:
        continue
    evt_start = parse_ts(e['timestamp'])
    evt_end = evt_start + timedelta(seconds=e['duration'])
    if afk_periods and is_during_afk(evt_start, evt_end):
        filtered_count += 1
        continue
    transformed.append({
        'timestamp': utc_iso(evt_start),
        'duration': e['duration'],
        'app': app,
        'title': e.get('data', {}).get('title', ''),
    })

if filtered_count > 0:
    print(f'Filtered {filtered_count} AFK events', file=sys.stderr)

print(json.dumps({'device_name': device_name, 'events': transformed}))
" "$EVENTS" "$AFK_EVENTS" "$DEVICE_NAME")

PUSH_COUNT=$(echo "$PAYLOAD" | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('events', [])))" 2>/dev/null || echo 0)

if [[ "$PUSH_COUNT" -eq 0 ]]; then
  echo "All events were AFK — nothing to push"
  echo "$END_TIME" > "$STATE_FILE"
  exit 0
fi

echo "Pushing ${PUSH_COUNT} events (${EVENT_COUNT} total, $((EVENT_COUNT - PUSH_COUNT)) filtered as AFK)"

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
AGENT_EOF
  chmod 755 "$AGENT.tmp"
  mv -f "$AGENT.tmp" "$AGENT"
}

write_env() {
  mkdir -p "$CONFIG_DIR"
  chmod 700 "$CONFIG_DIR"
  (
    umask 077
    printf 'AURBODA_URL="%s"\nAURBODA_TOKEN="%s"\nDEVICE_NAME="%s"\n' "$URL" "$TOKEN" "$DEVICE" >"$ENV_FILE"
  )
  chmod 600 "$ENV_FILE"
}

has_cron_line() {
  command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -F "$CRON_MARK" >/dev/null
}

remove_cron_line() {
  if has_cron_line; then
    { crontab -l 2>/dev/null | grep -vF "$CRON_MARK" || true; } | crontab -
  fi
}

add_cron_line() {
  local line
  line=$(printf '*/5 * * * * "%s" >> "%s/push.log" 2>&1 %s' "$AGENT" "$STATE_DIR" "$CRON_MARK")
  { crontab -l 2>/dev/null | grep -vF "$CRON_MARK" || true; printf '%s\n' "$line"; } | crontab -
}

has_systemd_user() {
  command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1
}

install_systemd_timer() {
  mkdir -p "$SYSTEMD_DIR" || return 1
  cat >"$SYSTEMD_DIR/aw-aurboda.service" <<EOF || return 1
[Unit]
Description=ActivityWatch → Aurboda push agent
After=network-online.target

[Service]
Type=oneshot
EnvironmentFile=$ENV_FILE
ExecStart=$AGENT
StandardOutput=journal
StandardError=journal
EOF
  cat >"$SYSTEMD_DIR/aw-aurboda.timer" <<'EOF' || return 1
[Unit]
Description=Run ActivityWatch → Aurboda push every 5 minutes

[Timer]
OnCalendar=*:0/5
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl --user daemon-reload && systemctl --user enable --now aw-aurboda.timer >/dev/null 2>&1
}

remove_systemd_timer() {
  if command -v systemctl >/dev/null 2>&1 && [ -f "$SYSTEMD_DIR/aw-aurboda.timer" ]; then
    systemctl --user disable --now aw-aurboda.timer >/dev/null 2>&1 || true
  fi
  rm -f "$SYSTEMD_DIR/aw-aurboda.timer" "$SYSTEMD_DIR/aw-aurboda.service"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi
}

schedule_linux() {
  if has_systemd_user && install_systemd_timer; then
    remove_cron_line
    say "✓ Runs every 5 minutes (systemd user timer aw-aurboda.timer)"
    say "  Log: journalctl --user -u aw-aurboda.service"
    return
  fi
  remove_systemd_timer
  if command -v crontab >/dev/null 2>&1; then
    mkdir -p "$STATE_DIR"
    add_cron_line
    say "✓ Runs every 5 minutes (crontab entry marked '$CRON_MARK')"
    say "  Log: $STATE_DIR/push.log"
  else
    warn "Neither a systemd user session nor crontab is available, so nothing was scheduled."
    warn "Run $AGENT every 5 minutes some other way."
  fi
}

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

unload_launch_agent() {
  if launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    sleep 1
  else
    launchctl unload "$PLIST" >/dev/null 2>&1 || true
  fi
}

schedule_macos() {
  mkdir -p "$(dirname "$PLIST")" "$STATE_DIR"
  unload_launch_agent
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml_escape "$AGENT")</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$STATE_DIR/push.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$STATE_DIR/push.log")</string>
</dict>
</plist>
EOF
  if launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl load -w "$PLIST" >/dev/null 2>&1; then
    say "✓ Runs every 5 minutes (launch agent $LABEL)"
    say "  Log: $STATE_DIR/push.log"
  else
    warn "Could not load the launch agent $PLIST. Log out and in again, or run: launchctl load -w '$PLIST'"
  fi
}

check_requirements() {
  command -v curl >/dev/null 2>&1 || die "curl is required."
  if ! python3 -c 'import json' >/dev/null 2>&1; then
    if [ "$OS" = Darwin ]; then
      die "python3 is required. Install Apple's command line tools with: xcode-select --install — then run this again."
    fi
    die "python3 is required. Install it with your package manager (for example: sudo apt install python3), then run this again."
  fi
  if curl -sf --max-time 3 "$AW_URL/api/0/info" >/dev/null 2>&1; then
    say "✓ ActivityWatch is running"
  else
    warn "ActivityWatch is not answering at $AW_URL yet. Install it from https://activitywatch.net and start it;"
    warn "the agent sends data from the first run after it is up."
  fi
}

uninstall() {
  if [ "$OS" = Darwin ]; then
    unload_launch_agent
    rm -f "$PLIST"
  fi
  remove_systemd_timer
  remove_cron_line
  rm -f "$AGENT"
  rm -rf "$CONFIG_DIR" "$STATE_DIR"
  if [ -n "${XDG_STATE_HOME:-}" ]; then
    rm -rf "$XDG_STATE_HOME/aw-aurboda"
  fi
  say "✓ Removed the ActivityWatch → Aurboda agent, its schedule and its settings."
}

main() {
  TOKEN="${AURBODA_TOKEN:-}"
  DEVICE=""
  URL="$DEFAULT_URL"
  ACTION=install

  while [ $# -gt 0 ]; do
    case "$1" in
      --token) [ $# -ge 2 ] || die "--token needs a value"; TOKEN="$2"; shift 2 ;;
      --token=*) TOKEN="${1#*=}"; shift ;;
      --device) [ $# -ge 2 ] || die "--device needs a value"; DEVICE="$2"; shift 2 ;;
      --device=*) DEVICE="${1#*=}"; shift ;;
      --url) [ $# -ge 2 ] || die "--url needs a value"; URL="$2"; shift 2 ;;
      --url=*) URL="${1#*=}"; shift ;;
      --uninstall) ACTION=uninstall; shift ;;
      -h | --help) usage; exit 0 ;;
      *) die "Unknown option: $1 (see --help)" ;;
    esac
  done

  OS=$(uname -s)
  case "$OS" in
    Linux | Darwin) ;;
    *) die "This installer is for Linux and macOS. On Windows, use the PowerShell installer (activitywatch.ps1)." ;;
  esac

  if [ "$ACTION" = uninstall ]; then
    uninstall
    return
  fi

  [ -n "$TOKEN" ] || die "Pass your Aurboda API key with --token <TOKEN>."
  matches "$TOKEN" '^[A-Za-z0-9+/=._:~-]+$' || die "That does not look like an Aurboda API key."
  URL="${URL%/}"
  matches "$URL" '^https?://[A-Za-z0-9._~:/%@+-]+$' || die "Pass the Aurboda API URL with --url https://…"
  if [ -z "$DEVICE" ]; then
    DEVICE=$(hostname 2>/dev/null || uname -n)
  fi
  matches "$DEVICE" '^[A-Za-z0-9._ -]{1,100}$' ||
    die "Device name '$DEVICE' has unsupported characters; pick one with --device <name> (letters, digits, . _ - and spaces)."

  check_requirements
  write_agent
  write_env
  say "✓ Installed the agent at $AGENT (settings in $ENV_FILE)"

  if [ "$OS" = Darwin ]; then
    schedule_macos
  else
    schedule_linux
  fi

  say ""
  say "Running the agent once:"
  if env -u AURBODA_TOKEN -u AURBODA_URL -u DEVICE_NAME "$AGENT" </dev/null; then
    say "✓ Done. Data from '$DEVICE' shows up in Aurboda within a few minutes of ActivityWatch running."
  else
    warn "The first run failed (see above). The schedule retries every 5 minutes."
  fi

  local source_url="$DEFAULT_URL"
  matches "$source_url" '^https?://' || source_url="$URL"
  say ""
  say "To uninstall: curl -fsSL $source_url/agents/activitywatch.sh | bash -s -- --uninstall"
}

main "$@"
